// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { selectCandidates } from '@deepseek-ai/dsh-evolution-merge-engine'

const row = (overrides: Record<string, unknown>) => ({ a: 'a', b: 'b', level: 'L2', verdict_id: -1, reason: 'x', ...overrides })
const select = (report: Record<string, unknown>) => selectCandidates(report) as { candidates: unknown[]; skipped: unknown[]; reportOnly: unknown[] }

it('L2 KEEP becomes skipped; L0/L1 stay reportOnly', () => {
  const selection = select({ pairs_final: [
    row({ level: 'L0', verdict_id: -1 }),
    row({ level: 'L1', verdict_id: -1 }),
    row({ level: 'L2', verdict_id: -1 }),
  ] })
  assert.equal(selection.candidates.length, 0)
  assert.equal(selection.skipped.length, 1)
  assert.equal(selection.reportOnly.length, 2)
})

it('L2 MERGE/UNDECIDED are candidates and fallback bypasses level', () => {
  const merge = select({ pairs_final: [row({ verdict_id: 1 }), row({ verdict_id: 0 })] })
  assert.equal(merge.candidates.length, 2)
  const fallback = select({ pairs_final: [row({ level: 'L0', verdict_id: -1 })], stage5_judge: { fallback: 'judge-down' } })
  assert.equal(fallback.candidates.length, 1)
  assert.equal(fallback.skipped.length, 0)
  assert.equal(fallback.reportOnly.length, 0)
})
