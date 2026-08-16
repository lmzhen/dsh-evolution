import { describe, expect, it } from 'vitest'
import { comparePlans } from '../src/index.ts'

describe('evolution-replay', () => {
  it('selects the plan with better accepted/evidence and lower cost', () => {
    const result = comparePlans([
      { policyId: 'A', acceptedOps: 3, rejectedOps: 1, memoryOps: 2, skillOps: 1, evidenceQuotes: 3, estimatedInputChars: 2000 },
      { policyId: 'B', acceptedOps: 4, rejectedOps: 0, memoryOps: 2, skillOps: 2, evidenceQuotes: 4, estimatedInputChars: 1800 },
    ])
    expect(result.winner).toBe('B')
    expect(result.margin).toBeGreaterThan(0)
  })
})
