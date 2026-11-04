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
import type { ConfigFormLike, ConfigFormSnapshotLike, ConfigFormsSeat, ConfigPathOpLike } from './seam.ts'
import { ROUTES } from './generated/routes.generated.ts'

interface FamilySnapshot extends ConfigFormSnapshotLike<Record<string, unknown>> {
  reason?: string
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

async function write(namespace: string, ops: readonly ConfigPathOpLike[], expectedRevision?: number): Promise<{ ok: boolean; snapshot?: FamilySnapshot }> {
  try {
    const response = await fetch(SETTINGS_MUTATE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ns: namespace, ops, ...(expectedRevision === undefined ? {} : { expectedRevision }) }),
    })
    if (!response.ok) return { ok: false }
    const body = await response.json() as { ok?: boolean; data?: unknown }
    return { ok: body.ok === true, snapshot: snapshotFrom(body.data, namespace) }
  } catch { return { ok: false } }
}

function createForm(namespace: string, ctx: ContextLike): ConfigFormLike {
  let snapshot: FamilySnapshot = { ...EMPTY, reason: 'seat-missing' }
  const listeners = new Set<() => void>()
  let started = false
  let listening = false
  const notify = (): void => { for (const listener of listeners) listener() }
  const refresh = async (): Promise<void> => {
    snapshot = await describe(namespace)
    notify()
  }
  const start = (): void => {
    if (started) return
    started = true
    if (!listening) {
      listening = true
      const remote = (ctx as { get?: (name: string) => unknown }).get?.('remote') as { $on?: (event: string, listener: (namespace: string) => void) => () => void } | undefined
      remote?.$on?.('settings/document-updated', (changed) => { if (changed === namespace) void refresh() })
    }
    void refresh()
  }
  const form: ConfigFormLike = {
    getSnapshot: () => snapshot as ConfigFormSnapshotLike,
    subscribe: (listener) => {
      listeners.add(listener)
      start()
      return () => { listeners.delete(listener) }
    },
    set: async (field, value) => (await form.mutate([{ op: 'set', path: [field], value }])),
    unset: async (field) => (await form.mutate([{ op: 'unset', path: [field] }])),
    mutate: async (ops, expectedRevision) => {
      const revision = expectedRevision ?? snapshot.revision
      const outcome = await write(namespace, ops, revision)
      if (outcome.snapshot !== undefined) { snapshot = outcome.snapshot; notify() }
      else await refresh()
      return outcome.ok
    },
  }
  return form
}

/**
 * Build one cached form per family namespace over the family settings routes.
 * @param ctx - the client plugin context (remote subscription is optional).
 * @returns the seat; each namespace is served by /api/dsh-evolution/settings/*.
 */
const seats = new WeakMap<object, ConfigFormsSeat>()

export function createSettingsSeat(ctx: ContextLike): ConfigFormsSeat {
  const cached = seats.get(ctx as object)
  if (cached !== undefined) return cached
  const forms = new Map<string, ConfigFormLike>()
  const seat: ConfigFormsSeat = {
    get<T>(namespace: string): ConfigFormLike<T> | undefined {
      let form = forms.get(namespace)
      if (form === undefined) { form = createForm(namespace, ctx); forms.set(namespace, form) }
      return form as ConfigFormLike<T>
    },
  }
  seats.set(ctx as object, seat)
  return seat
}
