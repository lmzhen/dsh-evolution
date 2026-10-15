// @tier pre-tag
/** G2b/2b.4: the compatibility declaration must EXIST and answer the two questions. Deleting the constant,
 * dropping a table entry, or declaring both `compatibleVersions` and `layout` turns this red - which is
 * what "声明缺省即红" means for a surface whose absence used to be silent. */
import { expect, it } from 'vitest'
import { EVOLUTION_DOMAIN, EVOLUTION_DOMAIN_COMPATIBILITY } from '../src/index.ts'

it('G2b/2b.4: every declared table carries an invalid-record tier, and the version axis is declared', () => {
  const declared = EVOLUTION_DOMAIN_COMPATIBILITY
  const tables = Object.keys(EVOLUTION_DOMAIN.tables)
  expect(declared.invalidRecords.map(entry => entry.table).sort()).toEqual([...tables].sort())
  for (const entry of declared.invalidRecords) {
    expect(['regenerable', 'irreplaceable']).toContain(entry.tier)
    expect(entry.why.length).toBeGreaterThan(10)
  }
  const axes = [declared.compatibleVersions !== undefined, declared.layout !== undefined].filter(Boolean).length
  expect(axes).toBe(1)
})
