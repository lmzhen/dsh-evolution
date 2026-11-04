/** Resolve the platform's current main-view session without reading ctx in the component. */
interface SessionSummaryLike { id?: string; retainedBy?: { mainView?: number } }
interface SessionsLike { list?: { getSnapshot?: () => { byId?: Record<string, SessionSummaryLike> } } }

export function currentSessionId(ctx: unknown): string | undefined {
  const sessions = (ctx as { sessions?: SessionsLike }).sessions
  const byId = sessions?.list?.getSnapshot?.().byId
  if (byId === undefined) return undefined
  return Object.values(byId).find(session => (session.retainedBy?.mainView ?? 0) > 0)?.id
}
