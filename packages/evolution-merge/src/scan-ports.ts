/**
 * Compose the channel and authoring flow into ScanPorts for a scan run.
 *
 * Approval off: round1 keeps the child, round2 authors the staging tree, then commits.
 * Approval on: round1 disposes the child immediately; the row waits in pending and the later
 * approve run must open a new child (not handled by this factory).
 */
import type { EvolutionIoLike, UnitTransaction } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCandidate, MergeDecision, MergeRow } from './contracts.ts'
import { pairKey } from './contracts.ts'

function classifyCommitFailure(message: string): string {
  if (message.includes('目标技能') && (message.includes('被改过') || message.includes('不存在'))) return message.includes('被改过') ? 'target-changed' : 'target-taken'
  if (message.includes('来源技能') && message.includes('被改过')) return 'source-changed'
  if (message.includes('来源技能') && message.includes('不存在')) return 'source-gone'
  return 'authoring-failed'
}
import type { SkillCard } from './skill-card.ts'
import { runRound1OverChannel, type ChannelRound1Result, type ConversationChannelLike } from './channel-port.ts'
import type { CommitPort } from './commit-execute.ts'
import type { StageToolContext } from './stage-tool.ts'
import { runAuthoring } from './authoring-flow.ts'
import { buildRound2Prompt, MERGE_PROMPT_VERSION, promptHashOf } from './prompts.ts'
import { stageKeyOf } from './staging.ts'
import { createStageTree, reserveStage, type StageEntry } from './domain/stage-aggregate.ts'
import type { ScanPorts, ScanRound2Outcome } from './scan-run.ts'
import { sourceRevisionOf, targetRevisionOf } from './revision.ts'

export interface CreateScanPortsOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly cards: readonly SkillCard[]
  readonly screening: ScanPorts['screening']
  readonly resolve?: ScanPorts['resolve']
  readonly channel: ConversationChannelLike
  readonly parent: unknown
  readonly allow: readonly string[]
  readonly cwd?: string
  readonly timeoutMs: number
  readonly approval: boolean
  readonly commitPort: CommitPort
  readonly unit?: UnitTransaction | undefined
  readonly limits?: import('@deepseek-ai/dsh-evolution-core').SkillLimits | undefined
  readonly now: () => number
  readonly isBlocked?: (name: string) => boolean | Promise<boolean>
  readonly onChild?: (context: StageToolContext) => void
  readonly onChildClosed?: (childId: string) => void
}

export interface StageForCardsOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly cards: readonly SkillCard[]
  readonly now: () => number
}
export function createStageForCards(options: StageForCardsOptions) {
  return async (row: MergeRow, decision: MergeDecision): Promise<{ readonly ok: true; readonly entry: StageEntry } | { readonly ok: false; readonly message: string }> => {
    const stageKey = stageKeyOf(options.runId, pairKey(row.a, row.b))
    const entry: StageEntry = { version: 1, rowId: row.id, pairKey: row.pairKey, runId: options.runId, ref: stageKey, state: 'reserved', createdAt: options.now(), expiresAt: options.now() + 7 * 86_400_000, updatedAt: options.now() }
    await reserveStage(options.io, options.home, entry)
    const staged = await createStageTree(options.io, options.home, {
      runId: stageKey, target: decision.target,
      sources: options.cards.filter(card => card.name === row.a || card.name === row.b).map(card => ({ name: card.name, body: card.body, files: card.files ?? [] })),
      promptVersion: 'merge-b/v1', ttlDays: 7, now: options.now,
    })
    return staged.ok ? { ok: true as const, entry } : { ok: false as const, message: staged.message }
  }
}
export function createChannelScanPorts(options: CreateScanPortsOptions): ScanPorts {
  const sessions = new Map<string, { result: ChannelRound1Result; stageKey: string }>()
  return {
    screening: options.screening,
    ...(options.resolve === undefined ? {} : { resolve: options.resolve }),
    async round1(candidate: MergeCandidate, signal: AbortSignal) {
      const stageKey = stageKeyOf(options.runId, pairKey(candidate.a, candidate.b))
      const result = await runRound1OverChannel({
        channel: options.channel,
        parent: options.parent,
        cards: options.cards,
        allow: options.allow,
        cwd: options.cwd ?? options.home,
        timeoutMs: options.timeoutMs,
        onChildOpened: childId => options.onChild?.({ runId: stageKey, childId, expectedChildId: childId, phase: 'decide' }),
      }, candidate, signal)
      if (result.outcome.kind === 'merge') {
        if (options.approval) await result.dispose()
        else {
          sessions.set(pairKey(candidate.a, candidate.b), { result, stageKey })
          if (result.childId !== undefined) {
            options.onChild?.({ runId: stageKey, childId: result.childId, expectedChildId: result.childId, phase: 'author' })
          }
        }
      }
      const round1Usage = result.usage?.()
      const sourceRevision = result.outcome.kind === 'merge' ? sourceRevisionOf(options.cards, candidate.a, candidate.b) : undefined
      const target = result.outcome.kind === 'merge' ? result.outcome.decision?.target : undefined
      const targetRevision = target === undefined ? undefined : targetRevisionOf(options.cards, target)
      return result.outcome.kind === 'merge'
        ? {
          ...result.outcome, stagingRef: stageKey, stagingExpiresAt: options.now() + 7 * 86_400_000,
          ...(sourceRevision === undefined ? {} : { sourceRevision }),
          ...(targetRevision === undefined ? {} : { targetRevision }),
          ...(round1Usage === undefined ? {} : { usage: round1Usage }),
        }
        : result.outcome.kind === 'failed'
          ? { ...result.outcome, degraded: ['round1 child failed: ' + (result.outcome.failure?.code ?? 'unknown')], ...(round1Usage === undefined ? {} : { usage: round1Usage }) }
          : { ...result.outcome, ...(round1Usage === undefined ? {} : { usage: round1Usage }) }
    },
    stage: createStageForCards({ io: options.io, home: options.home, runId: options.runId, cards: options.cards, now: options.now }),
    async round2(row: MergeRow, decision: MergeDecision, signal: AbortSignal): Promise<ScanRound2Outcome> {
      const key = pairKey(row.a, row.b)
      const entry = sessions.get(key)
      if (entry === undefined) {
        return { kind: 'failed', failure: { stage: 'author', code: 'no-session', message: 'no same-child round2 session; approve must open a new child', retryable: false, retryFrom: 'none' } }
      }
      sessions.delete(key)
      try {
        const authored = await runAuthoring({
          io: options.io,
          home: options.home,
          runId: options.runId,
          stageKey: entry.stageKey,
          reuseStaging: true,
          target: decision.target,
          mode: decision.mode,
          cards: options.cards,
          commitPort: options.commitPort,
          ...(options.unit === undefined ? {} : { unit: options.unit }),
          now: options.now,
          ...(options.isBlocked === undefined ? {} : { isBlocked: options.isBlocked }),
          summary: 'merge ' + row.a + ' + ' + row.b,
          ...(options.limits === undefined ? {} : { limits: options.limits }),
          promptVersion: MERGE_PROMPT_VERSION,
          promptHash: promptHashOf(buildRound2Prompt(row, decision)),
          revisions: {
            ...(decision.targetRevisionRef === undefined ? {} : { targetRevision: decision.targetRevisionRef }),
            ...(decision.sourceRevisions === undefined ? {} : { sourceRevisions: decision.sourceRevisions }),
            ...(decision.supportDigest === undefined ? {} : { supportDigest: decision.supportDigest }),
          },
          author: async () => (await entry.result.author?.(row, decision, signal)) ?? 'authored',
        })
        const usage = entry.result.usage?.()
        if (!authored.ok) {
          const limit = authored.findings?.some(finding => finding.rule === 'limit') === true
          const code = authored.code ?? (limit ? 'merge-over-limit' : authored.findings === undefined ? classifyCommitFailure(authored.message) : 'merge-validation')
          return { kind: 'failed', failure: { stage: 'author', code, message: authored.message, retryable: code !== 'target-changed' && code !== 'source-changed' && code !== 'support-changed', retryFrom: code === 'target-changed' || code === 'source-changed' || code === 'support-changed' ? 'none' : 'agent2', ...(authored.lengths === undefined ? {} : { lengths: authored.lengths }), ...(usage === undefined ? {} : { usage }) }, }
        }
        const receipt = authored.commit.receipt
        return {
          kind: 'merged',
          ...(receipt?.unitId === undefined ? {} : { unitId: receipt.unitId }),
          ...(receipt?.evidenceSha256 === undefined ? {} : { evidenceSha256: receipt.evidenceSha256 }),
          ...(receipt?.validationPlan === undefined ? {} : { validationPlan: receipt.validationPlan }),
          ...(usage === undefined ? {} : { usage }),
          archived: receipt?.archived ?? [],
          target: { requested: decision.target, actual: authored.commit.plan.target, created: receipt?.create ?? false },
        }
      } finally {
        await entry.result.dispose()
        if (entry.result.childId !== undefined) options.onChildClosed?.(entry.result.childId)
      }
    },
  }
}
