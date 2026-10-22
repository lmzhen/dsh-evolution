/** Host selector correction: engine selector does not route judge errors to candidates. */
import { pairKeyOf, selectCandidates, toEngineCandidate } from '@deepseek-ai/dsh-evolution-merge-engine'
import type { CandidateSelection } from './engine-screen.ts'

type Row = Record<string, unknown>

export function selectWithErrors(report: Record<string, unknown>): CandidateSelection {
  const base = selectCandidates(report) as CandidateSelection
  const doc = (report.reportDoc ?? report) as { pairs_final?: unknown }
  const rows = Array.isArray(doc.pairs_final) ? doc.pairs_final as Row[] : []
  const errors = new Set<string>()
  for (const row of rows) {
    if (row.error !== true) continue
    const a = typeof row.a === 'string' ? row.a : ''
    const b = typeof row.b === 'string' ? row.b : ''
    if (a !== '' && b !== '') errors.add(pairKeyOf(a, b))
  }
  const candidates = base.candidates.filter(candidate => !errors.has(pairKeyOf(candidate.a, candidate.b)))
  const skipped = base.skipped.filter(item => !errors.has(item.pairKey))
  const reportOnly = base.reportOnly.filter((row) => {
    const value = row as { a?: unknown; b?: unknown }
    if (typeof value.a !== 'string' || typeof value.b !== 'string') return true
    return !errors.has(pairKeyOf(value.a, value.b))
  })
  for (const row of rows) {
    if (row.error !== true) continue
    const a = typeof row.a === 'string' ? row.a : ''
    const b = typeof row.b === 'string' ? row.b : ''
    if (a === '' || b === '') continue
    candidates.push(toEngineCandidate(row, typeof row.reason === 'string' ? row.reason : 'judge-error') as CandidateSelection['candidates'][number])
  }
  return { ...base, candidates, skipped, reportOnly }
}
