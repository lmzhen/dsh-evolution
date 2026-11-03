/**
 * One namespace's settings gateway: one scope for reads, one revision-fenced
 * write, and a read-back in `finally`. The gateway owns no subscription — the
 * platform settings scope already listens to document updates and resets.
 * @module @deepseek-ai/dsh-evolution-client-kit
 */
import type { ConfigPathOpLike } from './seam.ts'

/** The read side of a platform settings scope. */
export interface SettingsScopeLike {
  /** @returns the current namespace snapshot; only `revision` is read here. */
  getSnapshot(): { readonly revision?: number | undefined }
  /** Queue a fresh describe and settle after it publishes or is superseded. */
  load(): Promise<void>
}

/** The write transport; one call carries the complete op list. */
export interface SettingsMutationApi {
  mutate(input: {
    readonly ns: string
    readonly ops: readonly ConfigPathOpLike[]
    readonly expectedRevision?: number
  }): Promise<{ readonly result: { readonly ok: boolean } }>
}

/** Write verdict and the independent read-back verdict. */
export interface SettingsSaveResult {
  /** True only when the Host accepted the write. */
  readonly written: boolean
  /** Read-back outcome; never derived from `written`. */
  readonly readback: 'ok' | 'failed'
  /** Transport/write failure, retained when the read-back was still attempted. */
  readonly failure?: unknown
}

/**
 * Save one atomic op list and always read back.
 * @param options - namespace, bound scope, mutation transport, and ops.
 * @returns the write verdict plus the separate read-back verdict.
 */
export async function saveSettings(options: {
  readonly namespace: string
  readonly scope: SettingsScopeLike
  readonly api: SettingsMutationApi
  readonly ops: readonly ConfigPathOpLike[]
}): Promise<SettingsSaveResult> {
  const revision = options.scope.getSnapshot().revision
  let written = false
  let failure: unknown
  try {
    const response = await options.api.mutate({
      ns: options.namespace,
      ops: options.ops,
      ...(revision === undefined ? {} : { expectedRevision: revision }),
    })
    written = response.result.ok
  } catch (error) {
    failure = error
  }
  let readback: 'ok' | 'failed' = 'ok'
  try {
    await options.scope.load()
  } catch (error) {
    readback = 'failed'
    failure ??= error
  }
  return failure === undefined ? { written, readback } : { written, readback, failure }
}

/** The platform binder face; one call per namespace is the whole contract. */
export interface SettingsBinderLike {
  bind(spec: { readonly namespace: string }): SettingsScopeLike
}

/** One cached namespace gateway. */
export interface SettingsGateway {
  readonly scope: SettingsScopeLike
  /** Save through this gateway's cached scope. */
  save(ops: readonly ConfigPathOpLike[]): Promise<SettingsSaveResult>
}

/**
 * Bind each namespace once and reuse that scope for every later save.
 * @param binder - the platform settings-scope service.
 * @param api - the mutation transport.
 * @returns a lookup that creates one gateway per namespace.
 */
export function createSettingsGatewayCache(binder: SettingsBinderLike, api: SettingsMutationApi): (namespace: string) => SettingsGateway {
  const cache = new Map<string, SettingsGateway>()
  return (namespace) => {
    const existing = cache.get(namespace)
    if (existing !== undefined) return existing
    const scope = binder.bind({ namespace })
    const gateway: SettingsGateway = {
      scope,
      save: async ops => await saveSettings({ namespace, scope, api, ops }),
    }
    cache.set(namespace, gateway)
    return gateway
  }
}
