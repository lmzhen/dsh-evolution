// @tier pre-tag
/** G3/3.3: the footprint is the VISIBILITY half of the reclamation ledger. The block grammar already
 * carries the tri-state ([FACT]/[UNKNOWN]); these cases pin that a store with no reading is UNKNOWN
 * (never an invented zero) and that a manual store which did not run says so. */
import { expect, it } from 'vitest'
import { renderFacts } from '../src/render-facts.ts'

const emptyReport = { library: [], skills: [] } as never

it('G3/3.3: one footprint line per registered store, UNKNOWN when nothing was measured', () => {
  const facts = renderFacts(emptyReport, {
    signalsVersion: 'v0',
    signature: 'sig',
    footprint: [
      { id: 'skill-versions', unit: 'entries', used: 3, bound: '20 versions per skill', lastSweep: 'T', removed: 0 },
      { id: 'reports', unit: 'files', bound: '20/20/10 files across the three report buckets', skipped: 'manual trigger did not run' },
    ],
  })
  expect(facts).toContain('[FACT] signal=store/skill-versions')
  expect(facts).toContain('used=3')
  expect(facts).toContain('bound=20 versions per skill')
  expect(facts).toContain('[UNKNOWN] signal=store/reports')
  expect(facts).toContain('skipped=manual trigger did not run')
  expect(facts).toContain('verdict=unknown')
})

it('G3/3.3: no footprint option leaves the block exactly as it was', () => {
  const facts = renderFacts(emptyReport, { signalsVersion: "v0", signature: "sig" })
  expect(facts).not.toContain('signal=store/')
  expect(facts).toContain('<<<END FACTS>>>')
})
