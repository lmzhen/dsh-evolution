// @tier fast
// guard-scripts.negative.spec.ts (G4): the GUARD-side half of the four negative classes.
//
// Why it exists: those classes used to sit inside guard-scripts.spec.ts, each one welded to a
// green run against the real tree (the half G5 retires). The fixture definitions now live in
// test-support/mutation-fixture.ts - ONE source per class - and this suite drives the judge that
// owns each class, with the two-stage assertion (exit semantics + the judged object NAMED).
//
// The first test asserts the SHAPE of the fixture's contract (M4-12): a run is a number and two
// strings, and the helper reports a missing name rather than passing silently.
import { describe, expect, it, vi } from 'vitest'
// several child spawns per test; the family config's leaf-tier baseline is not assumed here
vi.setConfig({ testTimeout: 30_000 })
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { CROSS_PACKAGE_IMPORT_NAME, assertRunShape, runGuard, twoStage, undeclaredCrossPackageImport, vacuumRoot } from '../../test-support/mutation-fixture.ts'

const scripts = fileURLToPath(new URL('../../scripts', import.meta.url))
const closure = join(scripts, 'verify-dependency-closure.mjs')
const archGuards = join(scripts, 'verify-arch-guards.mjs')

describe('negative guards (G4): vacuum roots and undeclared cross-package imports', () => {
  it('the fixture contract is a shape: a run is a code plus two streams', async () => {
    const root = await vacuumRoot()
    expect(typeof root).toBe('string')
    const run = await runGuard(closure, [root])
    assertRunShape(run)
    expect(typeof run.code).toBe('number')
    expect(typeof run.stdout).toBe('string')
    expect(typeof run.stderr).toBe('string')
  })

  const CASES = [
    { label: 'dependency-closure: a vacuum root is a loud failure, not a pass', script: closure, args: [] as string[], build: vacuumRoot, code: 1, names: [] as string[] },
    { label: 'dependency-closure: an undeclared cross-package import is rejected BY NAME', script: closure, args: [] as string[], build: undeclaredCrossPackageImport, code: 1, names: [CROSS_PACKAGE_IMPORT_NAME] },
    { label: 'arch-guards: a vacuum root is a loud failure under --strict', script: archGuards, args: ['--strict'], build: vacuumRoot, code: 1, names: [] as string[] },
  ]
  for (const entry of CASES) {
    it(entry.label, async () => {
      const root = await entry.build()
      const run = await runGuard(entry.script, [root, ...entry.args])
      assertRunShape(run)
      const result = twoStage(run, { code: entry.code, names: entry.names })
      expect(result.missingNames, result.detail).toEqual([])
      expect(result.exitOk, result.detail).toBe(true)
    })
  }

  it('the two-stage helper FAILS on a wrong expectation (otherwise it proves nothing)', async () => {
    const root = await vacuumRoot()
    const run = await runGuard(closure, [root])
    // stage 1: the exit semantics are actually compared (a vacuum root never exits 0)
    expect(twoStage(run, { code: 0, names: [] }).exitOk).toBe(false)
    // stage 2: a name that is not in the output is reported, never assumed
    expect(twoStage(run, { code: 1, names: ['a-name-that-is-not-there'] }).missingNames).toEqual(['a-name-that-is-not-there'])
  })
})
