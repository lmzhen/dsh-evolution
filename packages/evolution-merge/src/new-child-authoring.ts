/**
 * Round2 with a NEW child (approval after the pending window). The child gets the round2
 * prompt and writes the staging tree; the plugin then runs the same gate/commit path.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeDecision, MergeRow } from './contracts.ts'
import type { SkillCard } from './skill-card.ts'
import type { ConversationChannelLike } from './channel-port.ts'
import { buildRound2Prompt, STANDBY_PROMPT } from './prompts.ts'
import { createStaging, readStaging, setStagingTarget, stageKeyOf, stagingRoot } from './staging.ts'
import { pairKey } from './contracts.ts'
import { readStagedTree } from './staged-tree.ts'
import { validateStagedTree, hasBlockingFinding } from './rules.ts'
import { commitStagedRun, type CommitPort } from './commit-execute.ts'
import type { StageToolContext } from './stage-tool.ts'
import type { ScanRound2Outcome } from './scan-run.ts'

export interface NewChildAuthoringOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly cards: readonly SkillCard[]
  readonly channel: ConversationChannelLike
  readonly parent: unknown
  readonly allow: readonly string[]
  readonly cwd?: string
  readonly timeoutMs: number
  readonly commitPort: CommitPort
  readonly now: () => number
  readonly onChild?: (context: StageToolContext) => void
  readonly onChildClosed?: (childId: string) => void
}

export async function runNewChildAuthoring(
  options: NewChildAuthoringOptions,
  row: MergeRow,
  decision: MergeDecision,
  signal: AbortSignal,
): Promise<ScanRound2Outcome> {
  const targetCard = options.cards.find(card => card.name === decision.target)
  if (targetCard?.protectionUnknown === true || targetCard?.protectedBy === 'pinned') return { kind: 'failed', failure: { stage: 'author', code: 'target-pinned', message: 'target is pinned: ' + decision.target, retryable: false, retryFrom: 'none' } }
  const stageKey = row.stagingRef ?? stageKeyOf(options.runId, pairKey(row.a, row.b))
  const existing = await readStaging(options.io, options.home, stageKey)
  if (existing.kind === 'present') {
    await setStagingTarget(options.io, options.home, stageKey, decision.target, decision.mode)
  } else {
    const staging = await createStaging(options.io, options.home, {
      runId: stageKey,
      target: decision.target,
      mode: decision.mode,
      sources: options.cards
        .filter(card => card.name === row.a || card.name === row.b)
        .map(card => ({ name: card.name, body: card.body, files: card.files ?? [] })),
      promptVersion: 'merge-b/v1',
      ttlDays: 7,
      now: options.now,
    })
    if (!staging.ok) return { kind: 'failed', failure: { stage: 'author', code: 'staging-create', message: staging.message, retryable: true, retryFrom: 'agent2' } }
  }
  const opened = await options.channel.open({
    parent: options.parent,
    label: 'merge-round2',
    promptText: STANDBY_PROMPT,
    kind: 'maintainer',
    allow: options.allow,
    cwd: stagingRoot(options.home, stageKey),
    timeoutMs: options.timeoutMs,
    signal,
  })
  if (opened.kind !== 'ok') {
    return { kind: 'failed', failure: { stage: 'author', code: opened.kind, message: opened.kind === 'unavailable' ? opened.reason : 'round2 aborted', retryable: opened.kind !== 'aborted', retryFrom: opened.kind === 'aborted' ? 'none' : 'agent2' } }
  }
  options.onChild?.({ runId: stageKey, childId: opened.childId, expectedChildId: opened.childId, phase: 'author' })
  try {
    if (opened.turn.stopReason !== 'completed') {
      return { kind: 'failed', failure: { stage: 'author', code: opened.turn.stopReason, message: 'standby did not complete', retryable: true, retryFrom: 'agent2' } }
    }
    const turn = await options.channel.continueTurn(opened.childId, buildRound2Prompt(row, decision, 'fresh'), { timeoutMs: options.timeoutMs, signal })
    if (turn.kind !== 'ok') return { kind: 'failed', failure: { stage: 'author', code: turn.kind, message: turn.kind === 'unavailable' ? turn.reason : 'round2 aborted', retryable: turn.kind !== 'aborted', retryFrom: turn.kind === 'aborted' ? 'none' : 'agent2' } }
    if (turn.turn.stopReason !== 'completed') {
      return { kind: 'failed', failure: { stage: 'author', code: turn.turn.stopReason, message: 'round2 did not complete', retryable: true, retryFrom: 'agent2' } }
    }
    const tree = await readStagedTree(options.io, options.home, stageKey)
    if (tree.kind !== 'present') return { kind: 'failed', failure: { stage: 'author', code: 'staging-missing', message: tree.kind === 'unknown' ? tree.reason : 'staged tree absent', retryable: true, retryFrom: 'agent2' } }
    const findings = validateStagedTree(tree.value)
    if (hasBlockingFinding(findings)) return { kind: 'failed', failure: { stage: 'validate', code: 'rule-gate', message: 'staged tree failed the rule gate', retryable: true, retryFrom: 'agent2' } }
    const commit = await commitStagedRun(options.io, options.home, stageKey, options.commitPort, { origin: 'subagent', summary: 'merge ' + row.a + ' + ' + row.b, now: options.now })
    if (!commit.ok) return { kind: 'failed', failure: { stage: 'commit', code: 'commit-failed', message: commit.message, retryable: true, retryFrom: 'agent2' } }
    const receipt = commit.receipt
    return {
      kind: 'merged',
      ...(receipt?.unitId === undefined ? {} : { unitId: receipt.unitId }),
      archived: receipt?.archived ?? [],
      target: { requested: decision.target, actual: commit.plan.target, created: receipt?.create ?? false },
    }
  } finally {
    try { await options.channel.dispose(opened.childId) } catch { /* teardown must not replace the outcome */ }
    options.onChildClosed?.(opened.childId)
  }
}

export function createNewChildRound2(options: Omit<NewChildAuthoringOptions, 'runId'>): (row: MergeRow, decision: MergeDecision, signal: AbortSignal, runId: string) => Promise<ScanRound2Outcome> {
  return (row, decision, signal, runId) => runNewChildAuthoring({ ...options, runId }, row, decision, signal)
}
