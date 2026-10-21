/**
 * Compose the channel and authoring flow into ScanPorts for a scan run.
 *
 * Approval off: round1 keeps the child, round2 authors the staging tree, then commits.
 * Approval on: round1 disposes the child immediately; the row waits in pending and the later
 * approve run must open a new child (not handled by this factory).
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCandidate, MergeDecision, MergeRow } from './contracts.ts'
import { pairKey } from './contracts.ts'
import type { SkillCard } from './skill-card.ts'
import { runRound1OverChannel, type ChannelRound1Result, type ConversationChannelLike } from './channel-port.ts'
import type { CommitPort } from './commit-execute.ts'
import type { StageToolContext } from './stage-tool.ts'
import { runAuthoring } from './authoring-flow.ts'
import { dropStaging, ensureStaging, stageKeyOf, stagingRoot } from './staging.ts'
import type { ScanPorts, ScanRound2Outcome } from './scan-run.ts'

export interface CreateScanPortsOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly cards: readonly SkillCard[]
  readonly screening: ScanPorts['screening']
  readonly channel: ConversationChannelLike
  readonly parent: unknown
  readonly allow: readonly string[]
  readonly cwd?: string
  readonly timeoutMs: number
  readonly approval: boolean
  readonly commitPort: CommitPort
  readonly now: () => number
  readonly onChild?: (context: StageToolContext) => void
  readonly onChildClosed?: (childId: string) => void
}

export function createChannelScanPorts(options: CreateScanPortsOptions): ScanPorts {
  const sessions = new Map<string, { result: ChannelRound1Result; stageKey: string }>()
  return {
    screening: options.screening,
    async round1(candidate: MergeCandidate, signal: AbortSignal) {
      const stageKey = stageKeyOf(options.runId, pairKey(candidate.a, candidate.b))
      const staged = await ensureStaging(options.io, options.home, {
        runId: stageKey,
        target: candidate.a + '-' + candidate.b,
        sources: options.cards.filter(card => card.name === candidate.a || card.name === candidate.b).map(card => ({ name: card.name, body: card.body, files: card.files ?? [] })),
        promptVersion: 'merge-b/v1',
        ttlDays: 7,
        now: options.now,
      })
      if (!staged.ok) return { kind: 'failed', failure: { stage: 'decide', code: 'staging-create', message: staged.message, retryable: true, retryFrom: 'agent1' } }
      const result = await runRound1OverChannel({
        channel: options.channel,
        parent: options.parent,
        cards: options.cards,
        allow: options.allow,
        cwd: stagingRoot(options.home, stageKey),
        timeoutMs: options.timeoutMs,
        onChildOpened: (childId) => options.onChild?.({ runId: stageKey, childId, expectedChildId: childId, phase: 'decide' }),
      }, candidate, signal)
      if (result.outcome.kind !== 'merge') {
        await dropStaging(options.io, options.home, stageKey)
      } else if (result.outcome.kind === 'merge') {
        if (options.approval) await result.dispose()
        else {
          sessions.set(pairKey(candidate.a, candidate.b), { result, stageKey })
          if (result.childId !== undefined) {
            options.onChild?.({ runId: stageKey, childId: result.childId, expectedChildId: result.childId, phase: 'author' })
          }
        }
      }
      return result.outcome.kind === 'merge'
        ? { ...result.outcome, stagingRef: stageKey, stagingExpiresAt: options.now() + 7 * 86_400_000 }
        : result.outcome
    },
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
          cards: options.cards,
          commitPort: options.commitPort,
          now: options.now,
          summary: 'merge ' + row.a + ' + ' + row.b,
          author: async () => {
            await entry.result.author?.(row, decision, signal)
            return 'authored'
          },
        })
        if (!authored.ok) {
          return { kind: 'failed', failure: { stage: 'author', code: 'authoring-failed', message: authored.message, retryable: true, retryFrom: 'agent2' } }
        }
        const receipt = authored.commit.ok ? authored.commit.receipt : undefined
        return {
          kind: 'merged',
          ...(receipt?.unitId === undefined ? {} : { unitId: receipt.unitId }),
          archived: receipt?.archived ?? [],
          target: { requested: decision.target, actual: decision.target, created: receipt?.create ?? false },
        }
      } finally {
        await entry.result.dispose()
        if (entry.result.childId !== undefined) options.onChildClosed?.(entry.result.childId)
      }
    },
  }
}
