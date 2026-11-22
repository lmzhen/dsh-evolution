/**
 * Read the panel workspace id from the platform's sessions + workspaces services.
 * @module @lmzhen/dsh-evolution-client-kit
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

interface SessionListStateLike {
  readonly byId?: Record<string, { readonly retainedBy?: { readonly mainView?: number } }>
}

interface SessionsSeatLike {
  readonly list?: { readonly getSnapshot?: () => SessionListStateLike }
}

interface WorkspaceListStateLike {
  readonly items?: readonly {
    readonly workspaceId?: unknown
    readonly sessionIds?: readonly string[]
  }[]
}

interface WorkspacesSeatLike {
  readonly list?: { readonly getSnapshot?: () => WorkspaceListStateLike }
}

/** The platform's notion of the current main-view session. */
function mainSessionId(seat: SessionsSeatLike | undefined): string | undefined {
  const byId = seat?.list?.getSnapshot?.()?.byId ?? {}
  for (const [id, row] of Object.entries(byId)) {
    if ((row.retainedBy?.mainView ?? 0) > 0) return id
  }
  return undefined
}

/**
 * Best-effort workspace id; a seat that is absent or refuses leaves the panel in local scope.
 * @param ctx - the client context.
 * @returns the current workspace id, or undefined.
 */
export function panelWorkspaceId(ctx: ClientContext): string | undefined {
  const get = (ctx as unknown as { get?: (name: string) => unknown }).get
  if (typeof get !== 'function') return undefined
  try {
    const sessionId = mainSessionId(get.call(ctx, 'sessions') as SessionsSeatLike | undefined)
    if (sessionId === undefined) return undefined
    const workspaces = get.call(ctx, 'workspaces') as WorkspacesSeatLike | undefined
    const row = workspaces?.list?.getSnapshot?.()?.items?.find(item => item.sessionIds?.includes(sessionId) === true)
    return typeof row?.workspaceId === 'string' && row.workspaceId.trim() !== '' ? row.workspaceId : undefined
  } catch { return undefined }
}
