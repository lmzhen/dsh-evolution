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
export function toEngineCandidate(p, fallback = '') {
  const level = p.level === 'L2(audit)' ? 'L2' : p.level
  return {
    a: p.a,
    b: p.b,
    score: p.rank_score ?? p.score,
    arms: Array.isArray(p.arms) ? p.arms : (Array.isArray(p.arm) ? p.arm : []),
    reason: fallback || p.reason,
    source: 'engine',
    gate: {
      level,
      verdict: p.verdict_id,
      reason: p.reason,
      heuristic: p.heuristic === true,
      auditOverride: p.level === 'L2(audit)'
    }
  }
}

export function selectCandidates(report) {
  const doc = report.reportDoc ?? report
  const rows = Array.isArray(doc.pairs_final) ? doc.pairs_final : []
  const fallback = doc.stage5_judge && doc.stage5_judge.fallback ? String(doc.stage5_judge.fallback) : ''
  const candidates = []
  const skipped = []
  const reportOnly = []
  for (const row of rows) {
    if (fallback || row.action === 'UNJUDGED') {
      candidates.push(toEngineCandidate(row, fallback || row.reason))
      continue
    }
    if (row.verdict_id === 1 || row.verdict_id === 0) {
      candidates.push(toEngineCandidate(row))
      continue
    }
    if (row.verdict_id === -1 && row.level === 'L2') {
      skipped.push({ pairKey: pairKeyOf(row.a, row.b), a: row.a, b: row.b, reason: row.reason })
      continue
    }
    reportOnly.push(row)
  }
  const candidatePairs = doc.stage2_candidates && typeof doc.stage2_candidates.candidate_pairs === 'number' ? doc.stage2_candidates.candidate_pairs : rows.length
  return { candidates, skipped, reportOnly, reportFallback: fallback, candidatePairs }
}
