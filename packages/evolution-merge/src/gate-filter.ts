/**
 * Gate filter: turn lexical/proposed candidates into the candidates scan may process.
 * L0 keeps are dropped unless the deterministic 10% audit re-runs L2 and overrides.
 */
import type { MergeCandidate } from './contracts.ts'
import { pairKey } from './contracts.ts'
import { runLadder, selectedForAudit, type GateCache, type GateFacts, type GateModelPort, type GateVerdict } from './ladder.ts'

export interface GateFilterOptions {
  readonly facts: readonly GateFacts[]
  readonly model: GateModelPort
  readonly modelName: string
  readonly signal: AbortSignal
  readonly runSeed: string
  readonly cache?: GateCache
  readonly auditRate?: number
}

export interface GateDecision {
  readonly candidate: MergeCandidate
  readonly verdicts: readonly GateVerdict[]
  readonly auditOverride: boolean
}

export interface GateFilterResult {
  readonly kept: readonly GateDecision[]
  readonly dropped: readonly GateDecision[]
  readonly errors: readonly { readonly candidate: MergeCandidate; readonly message: string }[]
  readonly calls: number
}

export async function filterCandidates(candidates: readonly MergeCandidate[], options: GateFilterOptions): Promise<GateFilterResult> {
  const kept: GateDecision[] = []
  const dropped: GateDecision[] = []
  const errors: { candidate: MergeCandidate; message: string }[] = []
  let calls = 0
  for (const candidate of candidates) {
    const first = await runLadder({
      level: 'L0', candidate, facts: options.facts, model: options.model,
      modelName: options.modelName, signal: options.signal,
      ...(options.cache === undefined ? {} : { cache: options.cache }),
    })
    calls += first.calls
    if (first.route === 'error') {
      errors.push({ candidate, message: first.error ?? 'gate error' })
      continue
    }
    if (first.route !== 'keep' || first.droppedAt !== 'L0') {
      if (first.route === 'merge' || first.route === 'undecided') kept.push({ candidate, verdicts: first.verdicts, auditOverride: false })
      else dropped.push({ candidate, verdicts: first.verdicts, auditOverride: false })
      continue
    }
    if (!selectedForAudit(pairKey(candidate.a, candidate.b), options.runSeed, options.auditRate ?? 0.1)) {
      dropped.push({ candidate, verdicts: first.verdicts, auditOverride: false })
      continue
    }
    const audit = await runLadder({
      level: 'L0', startLevel: 'L2', candidate, facts: options.facts, model: options.model,
      modelName: options.modelName, signal: options.signal,
      ...(options.cache === undefined ? {} : { cache: options.cache }),
    })
    calls += audit.calls
    if (audit.route === 'merge' || audit.route === 'undecided') {
      kept.push({ candidate, verdicts: [...first.verdicts, ...audit.verdicts], auditOverride: true })
    } else if (audit.route === 'error') {
      errors.push({ candidate, message: audit.error ?? 'audit gate error' })
    } else {
      dropped.push({ candidate, verdicts: [...first.verdicts, ...audit.verdicts], auditOverride: true })
    }
  }
  return { kept, dropped, errors, calls }
}
