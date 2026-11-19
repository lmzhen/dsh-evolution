/**
 * Review tool transport boundary.
 *
 * The review runner owns completion/limits; a channel owns the concrete tool
 * protocol. Native sends the parent-visible tool schemas directly. PTC will
 * supply the same port from a detached review child; the runner never branches
 * on the platform tool mode.
 *
 * @module @deepseek-ai/dsh-evolution-review/review-tool-channel
 */
import type { ToolSchema } from '@deepseek-ai/dsh-evolution-platform-contract'
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
  return {
    mode: 'native',
    visibleTools: (header?.tools ?? []).filter(tool => toolAllow.has(tool.name)) as readonly ToolSchema[],
    execute: (calls, signal) => tools.execute({ calls, signal, agent: executionAgent as ReviewParent }),
  }
}
