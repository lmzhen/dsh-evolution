/**
 * Channel adapter for round 1. It opens the merged child, parses the decision, and exposes
 * an author callback for round 2 when the same child continues. Commit is deliberately
 * outside this adapter: the caller owns staging -> commitStagedRun.
 */
import type { MergeDecision, MergeRow } from './contracts.ts'
import type { SkillCard } from './skill-card.ts'
import { parseDecision } from './decision.ts'
import { buildRound1Prompt, buildRound2Prompt, STANDBY_PROMPT } from './prompts.ts'
import type { ScanRound1Outcome } from './scan-run.ts'

export interface ChannelTurnLike {
  readonly text: string
  readonly stopReason: string
}

export type ChannelTurnOutcome =
  | { readonly kind: 'ok'; readonly childId: string; readonly turn: ChannelTurnLike }
  | { readonly kind: 'unavailable'; readonly code: string; readonly reason: string }
  | { readonly kind: 'aborted' }

export interface ConversationChannelLike {
  open(spec: {
    readonly parent: unknown
    readonly label: string
    readonly promptText: string
    readonly kind: 'reviewer' | 'maintainer'
    readonly allow: readonly string[]
    readonly cwd?: string
    readonly timeoutMs: number
    readonly signal?: AbortSignal
  }): Promise<ChannelTurnOutcome>
  continueTurn(
    childId: string,
    promptText: string,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): Promise<ChannelTurnOutcome>
  dispose(childId: string): Promise<void>
}

export interface ChannelRound1Options {
  readonly channel: ConversationChannelLike
  readonly parent: unknown
  readonly cards: readonly SkillCard[]
  readonly allow: readonly string[]
  readonly cwd?: string
  readonly timeoutMs: number
  readonly onChildOpened?: (childId: string) => void
}

export interface ChannelRound1Result {
  readonly outcome: ScanRound1Outcome
  readonly childId?: string
  /** Same-child round 2; absent for keep/fail/unavailable. */
  readonly author?: (row: MergeRow, decision: MergeDecision, signal: AbortSignal) => Promise<string>
  readonly dispose: () => Promise<void>
}

export async function runRound1OverChannel(
  options: ChannelRound1Options,
  candidate: { readonly a: string; readonly b: string },
  signal: AbortSignal,
): Promise<ChannelRound1Result> {
  let childId: string | undefined
  const dispose = async (): Promise<void> => {
    if (childId !== undefined) {
      const id = childId
      childId = undefined
      try { await options.channel.dispose(id) } catch { /* teardown must not replace the outcome */ }
    }
  }
  const opened = await options.channel.open({
    parent: options.parent,
    label: 'merge-round1',
    promptText: STANDBY_PROMPT,
    kind: 'reviewer',
    allow: options.allow,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    timeoutMs: options.timeoutMs,
    signal,
  })
  if (opened.kind === 'unavailable') return { outcome: { kind: 'failed', failure: { stage: 'decide', code: opened.code, message: opened.reason, retryable: true, retryFrom: 'agent1' } }, dispose }
  if (opened.kind === 'aborted') return { outcome: { kind: 'failed', failure: { stage: 'decide', code: 'aborted', message: 'round1 aborted', retryable: false, retryFrom: 'none' } }, dispose }
  childId = opened.childId
  if (opened.turn.stopReason !== 'completed') {
    await dispose()
    return { outcome: { kind: 'failed', failure: { stage: 'decide', code: opened.turn.stopReason, message: 'standby did not complete', retryable: true, retryFrom: 'agent1' } }, dispose }
  }
  try { options.onChildOpened?.(opened.childId) } catch (error) { await dispose(); return { outcome: { kind: 'failed', failure: { stage: 'decide', code: 'child-bind', message: String(error), retryable: true, retryFrom: 'agent1' } }, dispose } }
  const round1 = await options.channel.continueTurn(
    opened.childId,
    buildRound1Prompt(candidate, options.cards),
    { timeoutMs: options.timeoutMs, signal },
  )
  if (round1.kind !== 'ok') {
    await dispose()
    return { outcome: { kind: 'failed', failure: { stage: 'decide', code: round1.kind, message: round1.kind === 'unavailable' ? round1.reason : 'round1 aborted', retryable: round1.kind !== 'aborted', retryFrom: round1.kind === 'aborted' ? 'none' : 'agent1' } }, dispose }
  }
  if (round1.turn.stopReason !== 'completed') {
    await dispose()
    return { outcome: { kind: 'failed', failure: { stage: 'decide', code: round1.turn.stopReason, message: 'round1 did not complete', retryable: true, retryFrom: 'agent1' } }, dispose }
  }
  const parsed = parseDecision(round1.turn.text, candidate)
  if (!parsed.ok) {
    await dispose()
    return { outcome: { kind: 'failed', failure: { stage: 'decide', code: parsed.code, message: parsed.message, retryable: true, retryFrom: 'agent1' } }, dispose }
  }
  if (!parsed.decision.shouldMerge || parsed.decision.mode === 'keep') {
    await dispose()
    return { outcome: { kind: 'keep', decision: parsed.decision }, dispose }
  }
  const child = opened.childId
  return {
    outcome: { kind: 'merge', decision: parsed.decision },
    childId: child,
    dispose,
    async author(row, decision, turnSignal) {
      const turn = await options.channel.continueTurn(
        child,
        buildRound2Prompt(row, decision),
        { timeoutMs: options.timeoutMs, signal: turnSignal },
      )
      if (turn.kind !== 'ok') throw new Error(turn.kind === 'unavailable' ? turn.reason : 'round2 aborted')
      if (turn.turn.stopReason !== 'completed') throw new Error('round2 did not complete: ' + turn.turn.stopReason)
      return turn.turn.text
    },
  }
}
