/**
 * PTC review tool channel.
 *
 * PTC runs tools through `run_code`; its nested dispatch appends to
 * `exec.agent.session`. The review executor therefore passes a detached child
 * agent created by `@deepseek-ai/dsh-evolution-adapter/review-child`.
 *
 * The review completion tools (`review_done`, `review_wait`) are registered
 * ONCE per plugin instance by {@link PtcReviewToolHost}. Their `when` guard only
 * admits them while one of the host's review tasks is executing, and their
 * handlers resolve the control record from the active review context. This
 * avoids duplicate global registrations when two PTC reviews run at once.
 *
 * @module @deepseek-ai/dsh-evolution-review/review-ptc-channel
 */
import { defineTool } from '@deepseek-ai/dsh-evolution-adapter/values'
import type { ToolDefinition } from '@deepseek-ai/dsh-evolution-adapter/values'
import { currentReviewContext } from '@deepseek-ai/dsh-evolution-core'
import type { ReviewReport, ReviewToolOutcome } from './review-executor.ts'
import { REVIEW_DONE_TOOL_NAME, REVIEW_WAIT_TOOL_NAME, parseReviewReport } from './review-executor.ts'
import type { ReviewToolChannel } from './review-tool-channel.ts'
import type { ReviewWriteLocks } from './review-write-locks.ts'

/** Mutable completion state filled by the in-code review tools. */
export interface PtcReviewControl {
  done: boolean
  report?: ReviewReport
  waitCount: number
}

type PtcTools = {
  register(definition: ToolDefinition, options?: { when?: () => boolean }): () => void
  resolve?: (context: unknown) => Promise<unknown>
  execute?: (input: unknown) => Promise<unknown>
}


/** Keep PTC's in-program SDK to the review allowlist instead of the parent preset's full tool set. */
function filterToolSet(full: unknown, allowed: ReadonlySet<string>): unknown {
  if (full === null || typeof full !== 'object' || typeof (full as { view?: unknown }).view !== 'function') return new Map()
  const view = (full as { view(scope: unknown): unknown }).view.bind(full)
  return {
    view(scope: unknown) {
      const source = view(scope) as { entries?: () => Iterable<[string, unknown]> } | null
      if (source === null || typeof source.entries !== 'function') return new Map()
      const out = new Map<string, unknown>()
      for (const [name, definition] of source.entries()) if (allowed.has(name)) out.set(name, definition)
      return out
    },
    ...(typeof (full as { dispose?: unknown }).dispose === 'function' ? { dispose: () => (full as { dispose(): void }).dispose() } : {}),
  }
}

const PTC_INSTRUCTION = 'You are reviewing in PTC mode. Write one or more run_code programs that call the available review tools. When the review is complete, call tools.review_done as the only review action of that program. A precise no-op is still completed: always finish with tools.review_done instead of stopping without it. If a write reports resource-busy, call tools.review_wait and then re-read before retrying.'

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function controlFor(controls: ReadonlyMap<string, PtcReviewControl>, exec?: unknown): PtcReviewControl | undefined {
  const reviewId = currentReviewContext()?.reviewId
  if (reviewId !== undefined && controls.has(reviewId)) return controls.get(reviewId)
  // PTC program dispatch may cross an async boundary where the ALS context is
  // no longer visible. The child session id still carries the task identity.
  const sessionId = (exec as { agent?: { session?: { id?: unknown } } } | undefined)?.agent?.session?.id
  const text = typeof sessionId === 'string' ? sessionId : String(sessionId ?? '')
  for (const [taskId, control] of controls) if (text.startsWith('review-child:' + taskId + ':')) return control
  return undefined
}

function reviewDefinitions(controls: ReadonlyMap<string, PtcReviewControl>, locks: ReviewWriteLocks): ToolDefinition[] {
  const done = defineTool({
    name: REVIEW_DONE_TOOL_NAME,
    description: 'Finish the review. Must be the only review action in its program.',
    parameters: {
      summary: { type: 'string', required: true },
      memoryChanged: { type: 'boolean', required: true },
      skillsChanged: { type: 'array', items: { type: 'string' }, required: true },
      unresolved: { type: 'array', items: { type: 'string' }, required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'review_done accepted' }],
    },
    async execute(args, exec) {
      const raw = asObject(args)
      if (raw === undefined) return { ok: false }
      const parsed = parseReviewReport(JSON.stringify(raw))
      const control = controlFor(controls, exec)
      if (parsed === undefined || control === undefined) return { ok: false }
      control.report = parsed
      control.done = true
      return { ok: true }
    },
  })
  const wait = defineTool({
    name: REVIEW_WAIT_TOOL_NAME,
    description: 'Wait for a review resource lock after resource-busy; re-read before retrying.',
    parameters: {
      resource: { type: 'string', required: true },
      timeoutMs: { type: 'number' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: (_args, value: { ok: boolean }) => [{ type: 'text', text: value.ok ? 'review_wait released' : 'review_wait timed out' }],
    },
    async execute(args, exec) {
      const raw = asObject(args)
      const resource = typeof raw?.resource === 'string' ? raw.resource : ''
      const timeoutMs = typeof raw?.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) ? raw.timeoutMs : 1_000
      const control = controlFor(controls, exec)
      if (control === undefined) return { ok: false }
      control.waitCount += 1
      if (resource === '') return { ok: true }
      return { ok: await locks.wait(resource, timeoutMs, exec.signal) }
    },
  })
  return [done, wait]
}

/**
 * One shared registration surface for all PTC review channels in this plugin
 * instance. Construct once, `register()` once, then `channel()` per task.
 */
export class PtcReviewToolHost {
  private readonly controls = new Map<string, PtcReviewControl>()
  private readonly active = new Set<string>()
  private disposers: (() => void)[] = []
  private registered = false

  constructor(
    private readonly tools: PtcTools,
    private readonly locks: ReviewWriteLocks,
  ) {}

  /** Register the review-only tools once; idempotent. */
  register(): void {
    if (this.registered) return
    this.registered = true
    this.disposers = reviewDefinitions(this.controls, this.locks).map(definition => this.tools.register(definition, {
      when: () => {
        const reviewId = currentReviewContext()?.reviewId
        return reviewId !== undefined && this.active.has(reviewId)
      },
    }))
  }

  /** Build one task channel over the shared registration. */
  channel(taskId: string, parentHeaderTools: readonly { readonly name: string }[], childAgent: unknown, modelSelection: unknown, allowedTools: ReadonlySet<string>): ReviewToolChannel & { control: PtcReviewControl; dispose(): void } {
    this.register()
    const control: PtcReviewControl = { done: false, waitCount: 0 }
    this.controls.set(taskId, control)
    const host = this
    return {
      mode: 'ptc',
      visibleTools: parentHeaderTools as ReviewToolChannel['visibleTools'],
      instruction: PTC_INSTRUCTION,
      control,
      completion: () => control.done && control.report !== undefined ? { done: true, report: control.report, waitCount: control.waitCount } : undefined,
      async execute(calls, signal) {
        host.active.add(taskId)
        try {
          if (host.tools.execute === undefined) throw new Error('PTC review channel requires tools.execute')
          if (host.tools.resolve === undefined) throw new Error('PTC review channel requires tools.resolve for the review allowlist')
          const toolSet = filterToolSet(await host.tools.resolve({ agent: childAgent, modelSelection, signal }), allowedTools)
          return await host.tools.execute({ calls, signal, agent: childAgent, ...(toolSet === undefined ? {} : { toolSet }) }) as { readonly results: readonly ReviewToolOutcome[] }
        } finally {
          host.active.delete(taskId)
        }
      },
      dispose() {
        host.active.delete(taskId)
        host.controls.delete(taskId)
      },
    }
  }

  /** Remove the global registrations; used when the plugin fiber unloads. */
  dispose(): void {
    for (const dispose of this.disposers.reverse()) dispose()
    this.disposers = []
    this.controls.clear()
    this.active.clear()
    this.registered = false
  }
}
