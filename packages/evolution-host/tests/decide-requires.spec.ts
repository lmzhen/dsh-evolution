// @tier fast
// The three-axis fixture for the prerequisite decision (F11/F12/F15's whole decision face).
// Discipline: the FIRST assertion is a shape assertion (M4-12); the matrix is data; no fixture
// starts a process (the seam takes a stub); and no fixture asserts elapsed time - a budget kill
// only ever arrives as an injected killedBy.
import { describe, expect, it } from 'vitest'
import { ERRNO_CLASS, KINDS, LEGAL_COMBINATIONS, MODES, classifyErrno, createRunner, decideRequires, isLegalCombination } from '../../scripts/lib-run-gates.mjs'

describe('decideRequires: the contract shape', () => {
  it('exports the closed sets, the errno map and a total decision function', () => {
    expect(typeof decideRequires).toBe('function')
    expect(typeof createRunner).toBe('function')
    expect(KINDS).toEqual(['in-repo', 'external'])
    expect(MODES).toEqual(['run', 'present'])
    expect(LEGAL_COMBINATIONS).toEqual(['in-repo/run', 'in-repo/present', 'external/run', 'external/present'])
    expect(Object.keys(ERRNO_CLASS).sort()).toEqual(['EACCES', 'ENOENT', 'EPERM', 'ETIMEDOUT'])
    expect(classifyErrno('EWHATEVER')).toBe('unknown')
    expect(classifyErrno(undefined)).toBe(null)
    const decision = decideRequires({ status: 0 }, 'in-repo', 'run')
    expect(typeof decision.verdict).toBe('string')
    expect(typeof decision.criterionEvaluated).toBe('boolean')
    expect(typeof decision.evidence).toBe('string')
  })
})

const CASES = [
  { name: 'in-repo exit 0 proceeds', result: { status: 0 }, kind: 'in-repo', mode: 'run', verdict: 'pass', evaluated: true },
  { name: 'in-repo exit != 0 is a fail whose dependent invariant was never evaluated', result: { status: 1 }, kind: 'in-repo', mode: 'run', verdict: 'fail', evaluated: false, cause: 'requires-abort' },
  { name: 'in-repo ENOENT is red: the repo lost its own script', result: { status: null, errorCode: 'ENOENT' }, kind: 'in-repo', mode: 'run', verdict: 'fail', evaluated: false, cause: 'requires-abort' },
  { name: 'external ENOENT is cannot-decide: not built is not broken', result: { status: null, errorCode: 'ENOENT' }, kind: 'external', mode: 'run', verdict: 'cannot-decide', evaluated: false, cause: 'external-missing' },
  { name: 'EACCES cannot judge and names the code', result: { status: null, errorCode: 'EACCES' }, kind: 'in-repo', mode: 'run', verdict: 'cannot-decide', evaluated: false, cause: 'unknown-errno' },
  { name: 'an errno outside the map cannot judge either', result: { status: null, errorCode: 'EWHATEVER' }, kind: 'external', mode: 'run', verdict: 'cannot-decide', evaluated: false, cause: 'unknown-errno' },
  { name: 'a budget kill is fail even though nothing was judged', result: { status: null, killedBy: 'budget', budgetMs: 1, budgetFrom: 'tier' }, kind: 'in-repo', mode: 'run', verdict: 'fail', evaluated: false, cause: 'budget-timeout' },
  { name: 'an external signal cannot judge', result: { status: null, killedBy: 'external', signal: 'SIGTERM' }, kind: 'external', mode: 'run', verdict: 'cannot-decide', evaluated: false, cause: 'external-signal' },
  { name: 'a present product proceeds', result: { present: true, path: './x/dist' }, kind: 'in-repo', mode: 'present', verdict: 'pass', evaluated: true },
  { name: 'a missing product cannot judge', result: { present: false, path: './x/dist' }, kind: 'external', mode: 'present', verdict: 'cannot-decide', evaluated: false, cause: 'produced-missing' },
]

describe('decideRequires: (kind, mode) x observed result', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const decision = decideRequires(c.result, c.kind, c.mode)
      expect(decision.verdict).toBe(c.verdict)
      expect(decision.criterionEvaluated).toBe(c.evaluated)
      if (c.cause !== undefined) expect(decision.cause?.kind).toBe(c.cause)
      if (decision.verdict !== 'pass') {
        expect(typeof decision.next).toBe('string')
        expect(decision.next.length).toBeGreaterThan(20)
        expect(typeof decision.evidence).toBe('string')
        expect(decision.evidence).toContain(c.kind)
      }
    })
  }
})

describe('unlisted combinations fail closed', () => {
  const rows = [['vendored', 'run'], ['in-repo', 'always']]
  for (const row of rows) {
    const kind = String(row[0])
    const mode = String(row[1])
    it(kind + '/' + mode + ' has no declared combination', () => {
      expect(isLegalCombination(kind, mode)).toBe(false)
      const decision = decideRequires({ status: 0 }, kind, mode)
      expect(decision.verdict).toBe('cannot-decide')
      expect(decision.cause?.kind).toBe('unknown-combination')
      expect(decision.criterionEvaluated).toBe(false)
    })
  }
  it('an unknown killedBy fails closed instead of guessing an owner', () => {
    const decision = decideRequires({ status: null, killedBy: 'mystery' }, 'in-repo', 'run')
    expect(decision.verdict).toBe('cannot-decide')
    expect(decision.cause?.kind).toBe('unknown-combination')
  })
})

describe('createRunner: killedBy is observed, never inferred', () => {
  it('refuses to exist without a spawn function', () => {
    expect(() => createRunner({})).toThrow()
  })
  it('reads a timeout kill as budget and a bare signal as external', () => {
    const budget = createRunner({ spawn: () => ({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }) })
    const external = createRunner({ spawn: () => ({ status: null, signal: 'SIGTERM' }) })
    const clean = createRunner({ spawn: () => ({ status: 0 }) })
    expect(budget.run(['node', 'x.mjs'], { cwd: '.', timeoutMs: 1 }).killedBy).toBe('budget')
    expect(external.run(['node', 'x.mjs'], { cwd: '.', timeoutMs: 30000 }).killedBy).toBe('external')
    expect(clean.run(['node', 'x.mjs'], {}).killedBy).toBe(null)
  })
})
