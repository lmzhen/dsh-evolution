/** Batch 3 engine criteria projection: merge maps level/verdict/action, engine does not. */
export interface EngineCriteria {
  readonly decision: 'keep' | 'merge' | 'candidate'
  readonly validation: 'not-run' | 'report-only' | 'required'
  readonly commit: 'never' | 'if-approved' | 'required'
  readonly archive: 'none' | 'sources'
  readonly evidence: 'none' | 'receipt'
}
export function criteriaFrom(level: 'L0' | 'L1' | 'L2', verdict: 1 | 0 | -1, action: 'keep' | 'merge'): EngineCriteria {
  const candidate = level === 'L2' && verdict !== -1
  return {
    decision: action === 'keep' ? 'keep' : candidate ? 'merge' : 'candidate',
    validation: level === 'L2' ? 'required' : 'report-only',
    commit: candidate && action === 'merge' ? 'required' : 'never',
    archive: candidate && action === 'merge' ? 'sources' : 'none',
    evidence: candidate && action === 'merge' ? 'receipt' : 'none',
  }
}
