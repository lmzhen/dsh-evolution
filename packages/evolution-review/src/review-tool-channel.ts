/**
 * Review tool transport boundary.
 *
 * The review runner owns completion/limits; a channel owns the concrete tool
 * protocol. Native keeps the parent-visible tool catalog byte-identical for
 * prefix caching and enforces the review allowlist at dispatch; PTC supplies the
 * same port from a detached review child. The runner never branches on the
 * platform tool mode.
 *
 * @module @deepseek-ai/dsh-evolution-review/review-tool-channel
 */
import type { ToolSchema } from '@deepseek-ai/dsh-evolution-platform/contract'
import type { ReviewParent, ReviewReport, ReviewToolOutcome, ReviewToolPort } from './review-executor.ts'

/** One executable tool transport for a review task. */
export interface ReviewToolChannel {
  readonly mode: 'native' | 'ptc'
  /** Tool schemas the model may see; the runner adds `review_done` itself. */
  readonly visibleTools: readonly ToolSchema[]
  /** Extra instruction appended after the review prompt (channel-specific protocol). */
  readonly instruction?: string
  /** Completion reported by the channel after a batch (PTC's in-code review_done). */
  completion?(): { readonly done: boolean; readonly report?: ReviewReport; readonly waitCount?: number } | undefined
  /** Execute the model's calls; implementations must not append to the parent Session. */
  execute(calls: Parameters<ReviewToolPort['execute']>[0]['calls'], signal: AbortSignal): Promise<{ readonly results: readonly ReviewToolOutcome[] }>
}

/** Native transport: the frozen parent header's direct tools plus the live tools service. */
export function nativeReviewToolChannel(
  parent: ReviewParent,
  toolAllow: ReadonlySet<string>,
  tools: ReviewToolPort,
  executionAgent: unknown = parent,
): ReviewToolChannel {
  const header = parent.session.requestHeader()
  const blocked = (call: Parameters<ReviewToolPort['execute']>[0]['calls'][number]): ReviewToolOutcome => ({
    callId: call.id,
    result: {
      content: [{ type: 'text', text: 'Tool "' + call.name + '" is not available in this background review; use the review tools or finish with review_done.' }],
      isError: true,
    },
  })
  return {
    mode: 'native',
    // Cache-stability: the provider sees the same catalog as the parent. The
    // allowlist is enforced below, before any tool executes.
    visibleTools: (header?.tools ?? []) as readonly ToolSchema[],
    instruction: 'Use only the review tools in this catalog (skill_manage, memory, skill, skill_search, read, glob, grep). Any other tool call is rejected before execution.',
    async execute(calls, signal) {
      const runnable = calls.filter(call => toolAllow.has(call.name))
      if (runnable.length === 0) return { results: calls.map(blocked) }
      const executed = await tools.execute({ calls: runnable, signal, agent: executionAgent as ReviewParent })
      const byId = new Map(executed.results.map(result => [result.callId, result]))
      return { results: calls.map(call => byId.get(call.id) ?? blocked(call)) }
    },
  }
}
