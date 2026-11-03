/**
 * The platform settings-scope seat, adapted to the card's form shape.
 *
 * The platform removed `configForms`; the live seat is `ctx.settingsScope.bind({ namespace })`.
 * Reads keep the scope's stable snapshot; writes use ONE revision-fenced
 * `connection.api.settings.mutate` call and then reload the scope, so the card can
 * distinguish "write accepted" from "readback landed".
 * @module @lmzhen/dsh-evolution-client-kit
 */
import type { ConfigFormLike, ConfigFormSnapshotLike, ConfigFormsSeat, ConfigPathOpLike } from './seam.ts'

interface ScopeSnapshotLike {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  base: unknown
  user: unknown
  writable: boolean
  revision: number | undefined
}
interface ScopeLike {
  getSnapshot(): ScopeSnapshotLike
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}
interface BinderLike { bind(spec: { namespace: string }): ScopeLike }
interface ConnectionLike {
  api: {
    settings: {
      mutate(spec: { ns: string; ops: readonly ConfigPathOpLike[]; expectedRevision?: number }): Promise<{ result: { ok: boolean } }>
    }
  }
}
interface ContextLike { get?: (name: string) => unknown }

/**
 * Build one cached form per namespace over the platform settings scope.
 * The binder/connection are looked up on every `get` so a later-composed settings
 * surface is picked up without capturing an undefined seat at apply time.
 * @param ctx - the client plugin context.
 * @returns the seat; without the platform services each lookup is undefined.
 */
export function createSettingsSeat(ctx: ContextLike): ConfigFormsSeat {
  const forms = new Map<string, ConfigFormLike>()
  return {
    get<T>(namespace: string): ConfigFormLike<T> | undefined {
      const cached = forms.get(namespace)
      if (cached !== undefined) return cached as ConfigFormLike<T>
      const binder = ctx.get?.('settingsScope') as BinderLike | undefined
      const connection = ctx.get?.('connection') as ConnectionLike | undefined
      if (binder === undefined || connection === undefined) return undefined
      const scope = binder.bind({ namespace })
      const form: ConfigFormLike<T> = {
        getSnapshot: (): ConfigFormSnapshotLike<T> => scope.getSnapshot() as unknown as ConfigFormSnapshotLike<T>,
        subscribe: (listener) => scope.subscribe(listener),
        set: async (field, value) => {
          try { await scope.set(field, value); return true } catch { return false }
        },
        unset: async (field) => {
          try { await scope.unset(field); return true } catch { return false }
        },
        mutate: async (ops, expectedRevision) => {
          try {
            const revision = expectedRevision ?? scope.getSnapshot().revision
            const response = await connection.api.settings.mutate({
              ns: namespace,
              ops,
              ...(revision === undefined ? {} : { expectedRevision: revision }),
            })
            await scope.load()
            return response.result.ok
          } catch {
            await scope.load()
            return false
          }
        },
      }
      forms.set(namespace, form as ConfigFormLike)
      return form
    },
  }
}
