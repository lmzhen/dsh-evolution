/**
 * Read the panel workspace id from either workspace service shape.
 * @module @lmzhen/dsh-evolution-client-kit
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/**
 * Best-effort workspace id; a seat that is absent or refuses leaves the panel in local scope.
 * @param ctx - the client context.
 * @returns the current workspace id, or undefined.
 */
export function panelWorkspaceId(ctx: ClientContext): string | undefined {
  const get = (ctx as unknown as { get?: (name: string) => unknown }).get
  if (typeof get !== 'function') return undefined
  for (const name of ['workspace', 'uiWorkspace']) {
    try {
      const seat = get.call(ctx, name) as { readonly workspaceId?: unknown; readonly currentWorkspaceId?: unknown } | undefined
      const id = seat?.workspaceId ?? seat?.currentWorkspaceId
      if (typeof id === 'string' && id.trim() !== '') return id
    } catch { /* optional service: absence is the local scope */ }
  }
  return undefined
}
