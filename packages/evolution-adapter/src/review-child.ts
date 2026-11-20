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
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'

export interface ReviewChildAgent {
  /** Parent-shaped agent whose `session` is the detached child. */
  readonly agent: unknown
  /** The detached Session; exposed for tests and diagnostics. */
  readonly session: Session
  /** Drop the review child scope/executor; the Session remains in the store as a child record. */
  dispose(): Promise<void>
}

export interface ReviewChildOptions {
  /** Mount the PTC tool executor in the child scope (required for PTC programs). */
  readonly ptc?: boolean
}

let nextChild = 0

/**
 * Create a detached review child agent.
 * @param parent - the live parent agent; only its `session` is replaced.
 * @param taskId - review task identity used in the child Session id.
 */
export async function createReviewChildAgent(parent: unknown, taskId: string, options: ReviewChildOptions = {}): Promise<ReviewChildAgent> {
  const safe = taskId.replace(/[^A-Za-z0-9_.:-]/g, '_')
  const childId = SessionId(`review-child:${safe}:${nextChild++}`)
  const parentSession = (parent as { session?: { header?: { cwd?: unknown } } }).session
  const sessions = (parent as { ctx?: { sessions?: { create(id?: SessionId, options?: { meta?: { cwd?: string } }): Session } } }).ctx?.sessions
  const cwd = typeof parentSession?.header?.cwd === 'string' ? parentSession.header.cwd : undefined
  const child = sessions?.create(childId, cwd === undefined ? undefined : { meta: { cwd } }) ?? Session.create(childId)
  // Object.create keeps the parent's Agent prototype and identity-independent
  // fields while making this object the exact scope key used by tools.execute.
  const agent = Object.create(parent as object) as Record<PropertyKey, unknown>
  Object.defineProperty(agent, 'session', { value: child, enumerable: true, configurable: false })
  Object.defineProperty(agent, 'id', { value: child.id, enumerable: true, configurable: false })
  const parentCtx = (parent as { ctx?: { plugin?: unknown } }).ctx
  let scope: Scope | undefined
  if (parentCtx !== undefined && typeof parentCtx.plugin === 'function') {
    scope = createScope(parentCtx as never, agent, { parent: parent as object })
    Object.defineProperty(agent, 'ctx', { value: scope.ctx, enumerable: true, configurable: false })
  }
  if (options.ptc === true && scope !== undefined) {
    const specifier: string = '@deepseek-ai/dsh-tool-executor-ptc'
    const mod = await import(/* @vite-ignore */ specifier) as { apply?: (ctx: unknown, config: unknown) => void; default?: unknown }
    await scope.ctx.plugin(mod as never, {} as never)
  }
  return {
    agent,
    session: child,
    async dispose() { await scope?.dispose() },
  }
}
