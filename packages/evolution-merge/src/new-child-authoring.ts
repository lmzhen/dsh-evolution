/**
 * Round2 with a NEW child (approval after the pending window). The child gets the round2
 * prompt and writes the staging tree; the plugin then runs the same gate/commit path.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeDecision, MergeRow } from './contracts.ts'
import type { SkillCard } from './screening.ts'
import type { ConversationChannelLike } from './channel-port.ts'
import { buildRound2Prompt } from './prompts.ts'
import { createStaging } from './staging.ts'
import { readStagedTree } from './staged-tree.ts'
import { validateStagedTree, hasBlockingFinding } from './rules.ts'
import { commitStagedRun, type CommitPort } from './commit-execute.ts'
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
}

export async function runNewChildAuthoring(
  options: NewChildAuthoringOptions,
  row: MergeRow,
  decision: MergeDecision,
  signal: AbortSignal,
): Promise<ScanRound2Outcome> {
  const staging = await createStaging(options.io, options.home, {
    runId: options.runId,
    target: decision.target,
    sources: options.cards.map(card => ({ name: card.name, body: card.body, files: [] })),
    promptVersion: 'merge-pair/v1',
    ttlDays: 7,
    now: options.now,
  })
  if (!staging.ok) return { kind: 'failed', failure: { stage: 'author', code: 'staging-create', message: staging.message, retryable: true, retryFrom: 'agent2' } }
  const opened = await options.channel.open({
    parent: options.parent,
    label: 'merge-round2',
    promptText: buildRound2Prompt(row, decision),
    kind: 'maintainer',
    allow: options.allow,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    timeoutMs: options.timeoutMs,
    signal,
  })
  if (opened.kind !== 'ok') {
    return { kind: 'failed', failure: { stage: 'author', code: opened.kind, message: opened.kind === 'unavailable' ? opened.reason : 'round2 aborted', retryable: opened.kind !== 'aborted', retryFrom: opened.kind === 'aborted' ? 'none' : 'agent2' } }
  }
  try {
    if (opened.turn.stopReason !== 'completed') {
      return { kind: 'failed', failure: { stage: 'author', code: opened.turn.stopReason, message: 'round2 did not complete', retryable: true, retryFrom: 'agent2' } }
    }
    const tree = await readStagedTree(options.io, options.home, options.runId)
    if (tree.kind !== 'present') return { kind: 'failed', failure: { stage: 'author', code: 'staging-missing', message: tree.kind === 'unknown' ? tree.reason : 'staged tree absent', retryable: true, retryFrom: 'agent2' } }
    const findings = validateStagedTree(tree.value)
    if (hasBlockingFinding(findings)) return { kind: 'failed', failure: { stage: 'validate', code: 'rule-gate', message: 'staged tree failed the rule gate', retryable: true, retryFrom: 'agent2' } }
    const commit = await commitStagedRun(options.io, options.home, options.runId, options.commitPort, { origin: 'subagent', summary: 'merge ' + row.a + ' + ' + row.b, now: options.now })
    if (!commit.ok) return { kind: 'failed', failure: { stage: 'commit', code: 'commit-failed', message: commit.message, retryable: true, retryFrom: 'agent2' } }
    const receipt = commit.receipt
    return {
      kind: 'merged',
      ...(receipt?.unitId === undefined ? {} : { unitId: receipt.unitId }),
      archived: receipt?.archived ?? [],
      target: { requested: decision.target, actual: decision.target, created: receipt?.create ?? false },
    }
  } finally {
    try { await options.channel.dispose(opened.childId) } catch { /* teardown must not replace the outcome */ }
  }
}

export function createNewChildRound2(options: Omit<NewChildAuthoringOptions, 'runId'>): (row: MergeRow, decision: MergeDecision, signal: AbortSignal, runId: string) => Promise<ScanRound2Outcome> {
  return (row, decision, signal, runId) => runNewChildAuthoring({ ...options, runId }, row, decision, signal)
}
