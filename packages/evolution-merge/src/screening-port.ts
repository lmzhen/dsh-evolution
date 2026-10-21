/**
 * The real screening port: lexical floor + optional C3 proposal + optional L0–L2 gate.
 * Each stage is independently testable; this file only composes their frozen contracts.
 */
import { pairKey, type MergeCandidate } from './contracts.ts'
import { lexicalCandidates, type SkillCard, type ScreeningOptions } from './skill-card.ts'
import { proposePairs, type ModelPort } from './propose.ts'
import { filterCandidates } from './gate-filter.ts'
import type { GateCache, GateFacts, GateModelPort } from './ladder.ts'

export interface ScreeningForRunOptions extends Omit<BuildScreeningOptions, 'signal'> {
  readonly runSeed: string
}

export interface BuildScreeningOptions {
  readonly cards: readonly SkillCard[]
  readonly signal: AbortSignal
  readonly lexical?: ScreeningOptions
  readonly propose?: { readonly model: ModelPort; readonly shardSize?: number; readonly maxPairs?: number }
  readonly gate?: {
    readonly model: GateModelPort
    readonly modelName: string
    readonly runSeed: string
    readonly cache?: GateCache
    readonly auditRate?: number
  }
}

export interface ScreeningPortStats {
  readonly lexical: number
  readonly proposed: number
  readonly candidates: number
  readonly kept: number
  readonly dropped: number
  readonly gateCalls: number
  readonly gateErrors: number
  readonly shards: number
}

export interface ScreeningPortResult {
  readonly candidates: readonly MergeCandidate[]
  readonly stats: ScreeningPortStats
  readonly degraded: readonly string[]
}

export async function buildScreeningCandidates(options: BuildScreeningOptions): Promise<ScreeningPortResult> {
  const lexical = lexicalCandidates(options.cards, options.lexical)
  const merged = new Map<string, MergeCandidate>()
  for (const candidate of lexical.candidates) merged.set(pairKey(candidate.a, candidate.b), candidate)
  const degraded: string[] = []
  let proposed = 0
  let shards = 0
  if (options.propose !== undefined) {
    const proposal = await proposePairs(options.cards, options.propose.model, {
      signal: options.signal,
      ...(options.propose.shardSize === undefined ? {} : { shardSize: options.propose.shardSize }),
      ...(options.propose.maxPairs === undefined ? {} : { maxPairs: options.propose.maxPairs }),
    })
    proposed = proposal.candidates.length
    shards = proposal.shards
    degraded.push(...proposal.degraded)
    for (const candidate of proposal.candidates) {
      const key = pairKey(candidate.a, candidate.b)
      const existing = merged.get(key)
      if (existing === undefined) {
        merged.set(key, candidate)
        continue
      }
      const arms = [...new Set([...(existing.arms ?? []), ...(candidate.arms ?? [])])]
      merged.set(key, {
        ...existing,
        ...(candidate.reason === undefined || existing.reason !== undefined ? {} : { reason: candidate.reason }),
        ...(arms.length === 0 ? {} : { arms }),
      })
    }
  }
  let candidates = [...merged.values()].sort((left, right) =>
    (right.score ?? 0) - (left.score ?? 0)
    || left.a.localeCompare(right.a)
    || left.b.localeCompare(right.b))
  let kept = candidates.length
  let dropped = 0
  let gateCalls = 0
  let gateErrors = 0
  if (options.gate !== undefined) {
    const facts: GateFacts[] = options.cards.map(card => ({ name: card.name, description: card.description, body: card.body }))
    const filtered = await filterCandidates(candidates, {
      facts,
      model: options.gate.model,
      modelName: options.gate.modelName,
      signal: options.signal,
      runSeed: options.gate.runSeed,
      ...(options.gate.cache === undefined ? {} : { cache: options.gate.cache }),
      ...(options.gate.auditRate === undefined ? {} : { auditRate: options.gate.auditRate }),
    })
    candidates = filtered.kept.map(decision => decision.candidate)
    kept = filtered.kept.length
    dropped = filtered.dropped.length
    gateCalls = filtered.calls
    gateErrors = filtered.errors.length
    for (const error of filtered.errors) degraded.push('gate error: ' + error.candidate.a + ' + ' + error.candidate.b + ': ' + error.message)
  }
  return {
    candidates,
    stats: {
      lexical: lexical.candidates.length,
      proposed,
      candidates: merged.size,
      kept,
      dropped,
      gateCalls,
      gateErrors,
      shards,
    },
    degraded,
  }
}

/** Build the run-scoped screening function; the run id seeds the 10% audit. */
export function createScreeningForRun(options: ScreeningForRunOptions): (signal: AbortSignal) => Promise<readonly MergeCandidate[]> {
  const gate = options.gate === undefined ? undefined : { ...options.gate, runSeed: options.runSeed }
  return async signal => (await buildScreeningCandidates({
    cards: options.cards,
    signal,
    ...(options.lexical === undefined ? {} : { lexical: options.lexical }),
    ...(options.propose === undefined ? {} : { propose: options.propose }),
    ...(gate === undefined ? {} : { gate }),
  })).candidates
}
