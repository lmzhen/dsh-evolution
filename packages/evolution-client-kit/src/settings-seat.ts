/**
 * Family settings data plane, adapted to the card's form shape.
 *
 * The platform RPC only serves its own namespace allowlist, so `connection.api.settings`
 * cannot read family namespaces even though the host settings provider has them.
 * These forms talk to the family's exact routes, which call the SAME platform
 * settings provider (schema validation, revision fencing, redaction and storage
 * stay platform-owned).
 * @module @lmzhen/dsh-evolution-client-kit
 */
import type { ConfigFormLike, ConfigFormSnapshotLike, ConfigFormsSeat, ConfigPathOpLike, ConfigWriteKind } from './seam.ts'
import { ROUTES } from './generated/routes.generated.ts'

interface FamilySnapshot extends ConfigFormSnapshotLike<Record<string, unknown>> {
  reason?: string
  stale?: boolean
}
interface ContextLike {
  get?: (name: string) => unknown
  remote?: { $on?: (event: string, listener: (namespace: string) => void) => () => void }
}

const SETTINGS_DESCRIBE = ROUTES.settings.describe
const SETTINGS_MUTATE = ROUTES.settings.mutate

const EMPTY: FamilySnapshot = Object.freeze({
  status: 'unavailable', value: undefined, user: undefined, writable: false, base: undefined, revision: undefined, reason: 'transport',
})

function snapshotFrom(value: unknown, ns: string): FamilySnapshot {
  if (typeof value !== 'object' || value === null) return EMPTY
  const list = (value as { namespaces?: unknown }).namespaces
  if (!Array.isArray(list)) return EMPTY
  const item = list.find(candidate => typeof candidate === 'object' && candidate !== null && (candidate as { ns?: unknown }).ns === ns) as FamilySnapshot | undefined
  return item === undefined ? { ...EMPTY, reason: 'not-served' } : item
}

async function describe(namespace: string): Promise<FamilySnapshot> {
  try {
    const response = await fetch(SETTINGS_DESCRIBE, { headers: { accept: 'application/json' } })
    if (!response.ok) return EMPTY
    const body = await response.json() as { ok?: boolean; data?: unknown }
    if (body.ok !== true) return EMPTY
    return snapshotFrom(body.data, namespace)
  } catch { return EMPTY }
}

/**
 * Classify one refused write from the exact route's response: the route answers 409 for a revision
 * CAS loss and 400 with an "invalid config" error for a schema refusal, so the card can name the
 * right cause instead of calling every refusal a concurrent edit.
 * @param response - the non-ok response.
 * @returns the refusal class; anything the route did not name stays transport.
 */
async function refusalKind(response: Response): Promise<ConfigWriteKind> {
  if (response.status === 409) return 'conflict'
  try {
    const body = await response.json() as { error?: unknown }
    return typeof body.error === 'string' && body.error.startsWith('invalid config') ? 'validation' : 'transport'
  } catch { return 'transport' }
}

async function write(namespace: string, ops: readonly ConfigPathOpLike[], expectedRevision?: number): Promise<{ ok: boolean; snapshot?: FamilySnapshot; kind?: ConfigWriteKind }> {
  try {
    const response = await fetch(SETTINGS_MUTATE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ns: namespace, ops, ...(expectedRevision === undefined ? {} : { expectedRevision }) }),
    })
    if (!response.ok) return { ok: false, kind: await refusalKind(response) }
    const body = await response.json() as { ok?: boolean; data?: unknown }
    return { ok: body.ok === true, snapshot: snapshotFrom(body.data, namespace) }
  } catch { return { ok: false, kind: 'transport' } }
}

function createForm(namespace: string, ctx: ContextLike): ConfigFormLike {
  let snapshot: FamilySnapshot = { ...EMPTY, reason: 'seat-missing' }
  let lastReady: FamilySnapshot | undefined
  let generation = 0
  const listeners = new Set<() => void>()
  let remoteOff: (() => void) | undefined
  const notify = (): void => { for (const listener of listeners) listener() }
  const absorb = (next: FamilySnapshot): void => {
    if (next.status === 'ready') {
      lastReady = next
      snapshot = next
    } else if (lastReady !== undefined) {
      // A failed re-read must not erase the last usable values. Keep ready + mark stale;
      // the card shows the values with a warning instead of claiming the plugin is absent.
      snapshot = { ...lastReady, stale: true, reason: next.reason ?? 'readback-failed' }
    } else {
      snapshot = next
    }
    notify()
  }
  const refresh = async (): Promise<void> => {
    const ticket = ++generation
    const next = await describe(namespace)
    if (ticket !== generation) return
    absorb(next)
  }
  const remote = (): { $on?: (event: string, listener: (namespace: string) => void) => () => void } | undefined =>
    (ctx as { get?: (name: string) => unknown }).get?.('remote') as { $on?: (event: string, listener: (namespace: string) => void) => () => void } | undefined
  const stopRemote = (): void => { remoteOff?.(); remoteOff = undefined }
  const startRemote = (): void => {
    if (remoteOff !== undefined) return
    remoteOff = remote()?.$on?.('settings/document-updated', (changed) => { if (changed === namespace) void refresh() })
  }
  const form: ConfigFormLike = {
    getSnapshot: () => snapshot as ConfigFormSnapshotLike,
    subscribe: (listener) => {
      listeners.add(listener)
      startRemote()
      void refresh()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stopRemote()
      }
    },
    set: async (field, value) => (await form.mutate([{ op: 'set', path: [field], value }])),
    unset: async (field) => (await form.mutate([{ op: 'unset', path: [field] }])),
    save: async (ops, expectedRevision) => {
      const revision = expectedRevision ?? snapshot.revision
      const outcome = await write(namespace, ops, revision)
      if (outcome.snapshot !== undefined) absorb(outcome.snapshot)
      else await refresh()
      return outcome.ok ? { written: true } : { written: false, kind: outcome.kind ?? 'transport' }
    },
    mutate: async (ops, expectedRevision) => {
      const revision = expectedRevision ?? snapshot.revision
      const outcome = await write(namespace, ops, revision)
      if (outcome.snapshot !== undefined) absorb(outcome.snapshot)
      else await refresh()
      return outcome.ok
    },
    refresh,
    dispose: () => { stopRemote(); listeners.clear() },
  }
  return form
}

/**
 * Build one seat per client registration; every form's remote listener is released by
 * the caller's effect. No module-level WeakMap: a replaced registration must not share
 * a dead seat with the previous one.
 */
export function createSettingsSeat(ctx: ContextLike): ConfigFormsSeat {
  const forms = new Map<string, ConfigFormLike>()
  return {
    get<T>(namespace: string): ConfigFormLike<T> | undefined {
      let form = forms.get(namespace)
      if (form === undefined) { form = createForm(namespace, ctx); forms.set(namespace, form) }
      return form as ConfigFormLike<T>
    },
    dispose: () => {
      for (const form of forms.values()) form.dispose?.()
      forms.clear()
    },
  }
}
