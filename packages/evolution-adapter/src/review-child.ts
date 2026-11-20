/**
 * Detached review child agent.
 *
 * PTC's `run_code` appends its nested `tool/ptc-dispatch*` frames to
 * `exec.agent.session`. A background review must never write those frames to the
 * parent Session, so the review executor calls the model with a child agent whose
 * `session` is a real, live Session created through the public Session store. The
 * child object is also the scope key of a real scoped context, so the platform's
 * executor selection can attach a PTC executor to this child without touching the
 * parent. This Session is detached from the parent lineage, but is live in the
 * SessionStore so platform tools can resolve its working directory and approval
 * context; the parent Session's seq is therefore untouched.
 *
 * The PTC executor is a platform-provided optional capability, not a family
 * dependency. It is loaded through a runtime probe, never through a declared
 * peer, so one family artifact can remain valid across the declared cohort while
 * a host without PTC mode fails with an explicit unavailable error.
 *
 * @module @deepseek-ai/dsh-evolution-adapter/review-child
 */
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'

/** The platform PTC executor is absent or not compatible with this host. */
export class PtcExecutorUnavailableError extends Error {
  readonly code = 'PTC_UNAVAILABLE'
  constructor(reason: string) {
    super('PTC executor unavailable: ' + reason)
    this.name = 'PtcExecutorUnavailableError'
  }
}

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

interface PtcExecutorPlugin {
  readonly apply: (ctx: unknown, config: unknown) => void
  readonly inject?: readonly string[]
}

/**
 * Probe the platform's optional PTC executor without declaring a family peer.
 * Shape checks fail closed: a host may ship an older/newer package, but an
 * incompatible export must surface as PTC_UNAVAILABLE, not as a generic startup
 * crash. The version is intentionally not inferred from the package name.
 */
async function loadPtcExecutor(): Promise<PtcExecutorPlugin> {
  const specifier: string = '@deepseek-ai/dsh-tool-executor-ptc'
  let module: { apply?: unknown; inject?: unknown }
  try {
    module = await import(/* @vite-ignore */ specifier) as { apply?: unknown; inject?: unknown }
  } catch {
    throw new PtcExecutorUnavailableError('platform package @deepseek-ai/dsh-tool-executor-ptc is not installed')
  }
  if (typeof module.apply !== 'function') {
    throw new PtcExecutorUnavailableError('@deepseek-ai/dsh-tool-executor-ptc has no apply() export')
  }
  if (module.inject !== undefined && (!Array.isArray(module.inject) || !module.inject.every(item => typeof item === 'string'))) {
    throw new PtcExecutorUnavailableError('@deepseek-ai/dsh-tool-executor-ptc has an incompatible inject export')
  }
  return module as PtcExecutorPlugin
}

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
  if (options.ptc === true) {
    if (scope === undefined) throw new PtcExecutorUnavailableError('the parent has no scoped context')
    const plugin = await loadPtcExecutor()
    await scope.ctx.plugin(plugin as never, {} as never)
  }
  return {
    agent,
    session: child,
    async dispose() { await scope?.dispose() },
  }
}
