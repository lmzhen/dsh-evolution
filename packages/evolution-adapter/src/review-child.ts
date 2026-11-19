/**
 * Detached review child agent.
 *
 * PTC's `run_code` appends its nested `tool/ptc-dispatch*` frames to
 * `exec.agent.session`. A background review must never write those frames to the
 * parent Session, so the review executor calls the model with a child agent whose
 * `session` is a real, detached `Session` created through the public Session API.
 * The parent agent is otherwise forwarded unchanged (ctx, status, working
 * directory), so tools keep their normal policy/working-directory behavior.
 *
 * This session is intentionally not registered in the SessionStore: it is a
 * per-review log sink, discarded with the review task. The parent Session's seq
 * is therefore untouched.
 *
 * @module @deepseek-ai/dsh-evolution-adapter/review-child
 */
import { Session, SessionId } from '@deepseek-ai/dsh-session'

export interface ReviewChildAgent {
  /** Parent-shaped agent whose `session` is the detached child. */
  readonly agent: unknown
  /** The detached Session; exposed for tests and diagnostics. */
  readonly session: Session
  /** Drop the review child; the detached Session is garbage-collected with it. */
  dispose(): void
}

let nextChild = 0

/**
 * Create a detached review child agent.
 * @param parent - the live parent agent; only its `session` is replaced.
 * @param taskId - review task identity used in the child Session id.
 */
export function createReviewChildAgent(parent: unknown, taskId: string): ReviewChildAgent {
  const safe = taskId.replace(/[^A-Za-z0-9_.:-]/g, '_')
  const childId = SessionId(`review-child:${safe}:${nextChild++}`)
  const parentSession = (parent as { session?: { header?: { cwd?: unknown } } }).session
  const sessions = (parent as { ctx?: { sessions?: { create(id?: SessionId, options?: { meta?: { cwd?: string } }): Session } } }).ctx?.sessions
  const cwd = typeof parentSession?.header?.cwd === 'string' ? parentSession.header.cwd : undefined
  const child = sessions?.create(childId, cwd === undefined ? undefined : { meta: { cwd } }) ?? Session.create(childId)
  const agent = new Proxy(parent as object, {
    get(target, property, receiver) {
      if (property === 'session') return child
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
  return {
    agent,
    session: child,
    dispose() { /* detached Session has no registry/persistence owner */ },
  }
}
