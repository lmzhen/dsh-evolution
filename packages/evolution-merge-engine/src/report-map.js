import { createHash } from 'node:crypto'

export function pairKeyOf(a, b) {
  return [a, b].sort().join('\u0000')
}

export function toCandidateFact(p) {
  return {
    score: p.rank_score ?? p.score,
    arms: Array.isArray(p.arm) ? p.arm : (Array.isArray(p.arms) ? p.arms : []),
    reason: p.reason,
    source: 'lexical'
  }
}

export function toReportPair(p, runId = 'engine') {
  const pairKey = pairKeyOf(p.a, p.b)
  return {
    id: runId + ':' + createHash('sha256').update(pairKey).digest('hex').slice(0, 16),
    pairKey,
    a: p.a,
    b: p.b,
    queue: p.verdict_id === 1 ? 'pending' : 'skipped',
    candidate: toCandidateFact(p),
    gate: { level: p.level, verdict: p.verdict_id, heuristic: p.heuristic === true },
    decision: undefined,
    outcome: p.verdict_id === 1 ? 'pending' : 'kept',
    target: undefined,
    archived: [],
    unitId: undefined,
    failure: p.error ? { stage: 'judge', code: 'JUDGE_ERROR', message: p.reason, retryable: true, retryFrom: 'agent2' } : undefined,
    usage: p.usage,
    timing: undefined,
    engineStage: 'judge',
    rankSource: p.rank_source,
    promptVersion: p.prompt_sha
  }
}

export function mapReport(report, runId = 'engine') {
  const doc = report.reportDoc ?? report
  const pairs = (doc.pairs_final ?? []).map(p => toReportPair(p, runId))
  return {
    schemaVersion: 1,
    runId,
    kind: 'merge',
    pairs,
    notes: [],
    scope: { candidatePairs: doc.stage2_candidates ? doc.stage2_candidates.candidate_pairs : pairs.length, queueBefore: { pending: 0, retry: 0, skipped: 0 } }
  }
}
