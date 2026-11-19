/**
 * PTC review tool channel.
 *
 * PTC runs tools through `run_code`; its nested dispatch appends to
 * `exec.agent.session`. The review executor therefore passes a detached child
 * agent created by `@deepseek-ai/dsh-evolution-adapter/review-child`. The review
 * completion tools (`review_done`, `review_wait`) are registered only while this
 * channel executes and only inside the matching review context, so the parent
 * model never sees them and the parent Session is never touched.
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

const PTC_INSTRUCTION = 'You are reviewing in PTC mode. Write one or more run_code programs that call the available review tools. When the review is complete, call tools.review_done as the only review action of that program; if a write reports resource-busy, call tools.review_wait and then re-read before retrying.'

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function reviewDefinitions(control: PtcReviewControl, locks: ReviewWriteLocks): ToolDefinition[] {
  const done = defineTool({
    name: REVIEW_DONE_TOOL_NAME,
    description: 'Finish the review. Must be the only review action in its program.',
    parameters: {
      summary: { type: 'string', required: true },
      memoryChanged: { type: 'boolean' },
      skillsChanged: { type: 'array', items: { type: 'string' } },
      unresolved: { type: 'array', items: { type: 'string' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'review_done accepted' }],
    },
    async execute(args) {
      const raw = asObject(args)
      if (raw === undefined) return { ok: false }
      const parsed = parseReviewReport(JSON.stringify(raw))
      if (parsed === undefined) return { ok: false }
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
      control.waitCount += 1
      if (resource === '') return { ok: true }
      return { ok: await locks.wait(resource, timeoutMs, exec.signal) }
    },
  })
  return [done, wait]
}

export interface PtcReviewChannelOptions {
  readonly taskId: string
  readonly parentHeaderTools: readonly { readonly name: string; readonly description?: string; readonly parameters?: unknown }[]
  readonly tools: {
    register(definition: ToolDefinition, options?: { when?: () => boolean }): () => void
    execute?: (input: unknown) => Promise<unknown>
  }
  readonly childAgent: unknown
  readonly locks: ReviewWriteLocks
}

/**
 * Build a PTC channel. The returned channel's `execute` temporarily registers
 * the in-code review tools, runs the PTC calls against the child agent, and
 * removes the registrations before returning.
 */
export function createPtcReviewToolChannel(options: PtcReviewChannelOptions): ReviewToolChannel & { control: PtcReviewControl; dispose(): void } {
  const control: PtcReviewControl = { done: false, waitCount: 0 }
  const definitions = reviewDefinitions(control, options.locks)
  let active = false
  const disposers = definitions.map(definition => options.tools.register(definition, {
    when: () => active && currentReviewContext()?.reviewId === options.taskId,
  }))
  const channel: ReviewToolChannel & { control: PtcReviewControl; dispose(): void } = {
    mode: 'ptc',
    visibleTools: options.parentHeaderTools as ReviewToolChannel['visibleTools'],
    instruction: PTC_INSTRUCTION,
    control,
    completion: () => control.done && control.report !== undefined ? { done: true, report: control.report } : undefined,
    async execute(calls, signal) {
      active = true
      try {
        if (options.tools.execute === undefined) throw new Error('PTC review channel requires tools.execute')
        return await options.tools.execute({ calls, signal, agent: options.childAgent }) as { readonly results: readonly ReviewToolOutcome[] }
      } finally {
        active = false
      }
    },
    dispose() { for (const dispose of disposers.reverse()) dispose() },
  }
  return channel
}
