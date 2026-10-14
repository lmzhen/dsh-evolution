#!/usr/bin/env node
/**
 * lib-run-gates.mjs (G1/S4): the runner seam and the PURE prerequisite decision.
 *
 * Why this exists: the executor used to spawn and judge in the same breath, so "why did this
 * tier abort?" could only be answered by running it, and a declared budget that never fired was
 * indistinguishable from an external kill. The two halves are now separate:
 *
 *   createRunner({ spawn })                 - the seam, injected at the CLI, NO env/CLI switch
 *   decideRequires(result, kind, mode)      - pure and total: no IO, no Date.now, no env
 *
 * killedBy is PASSED IN by the runner and never inferred from a declared timeout: "a budget was
 * declared and the process was externally SIGTERMed" must not read as a budget kill.
 */

/** The prerequisite kinds and modes; the cross product is the declared closed set. */
export const KINDS = ['in-repo', 'external']
export const MODES = ['run', 'present']
export const LEGAL_COMBINATIONS = KINDS.flatMap((kind) => MODES.map((mode) => kind + '/' + mode))

/** The errno classification the matrix branches on. A code outside this map is UNKNOWN, which is
 * a cannot-decide with the raw code named - never a silent pass and never a fail. */
export const ERRNO_CLASS = { ENOENT: 'missing', EACCES: 'denied', EPERM: 'denied', ETIMEDOUT: 'timeout' }

export function classifyErrno(code) {
  if (typeof code !== 'string' || code === '') return null
  return Object.prototype.hasOwnProperty.call(ERRNO_CLASS, code) ? ERRNO_CLASS[code] : 'unknown'
}

/** Declaration-time form check: an unlisted (kind, mode) has no semantics, so it is red there. */
export function isLegalCombination(kind, mode) {
  return LEGAL_COMBINATIONS.includes(String(kind) + '/' + String(mode))
}

/**
 * Decide ONE prerequisite from what the runner observed. Pure and total: every branch returns a
 * decision fragment (verdict + whether THIS check's invariant was evaluated + cause + next +
 * evidence), and an unlisted input never throws - it fails closed with unknown-combination.
 *
 * @param result {{ status?: number|null, errorCode?: string|null, killedBy?: string|null, signal?: string|null, present?: boolean, path?: string, budgetMs?: number, budgetFrom?: string, ms?: number }}
 * @param kind - in-repo | external
 * @param mode - run | present
 */
export function decideRequires(result, kind, mode) {
  const seen = result === undefined || result === null ? {} : result
  const where = 'requires(kind=' + String(kind) + ', mode=' + String(mode) + ')'
  if (!isLegalCombination(kind, mode)) {
    return { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'unknown-combination' },
      missing: [String(kind) + '/' + String(mode)],
      next: 'declare the prerequisite with kind in ' + KINDS.join('|') + ' and mode in ' + MODES.join('|') + ' - an unlisted combination has no semantics',
      evidence: where + ' is not one of ' + LEGAL_COMBINATIONS.join(', ') }
  }
  if (mode === 'present') {
    const path = String(seen.path === undefined || seen.path === null ? '(path not given)' : seen.path)
    if (seen.present === true) {
      return { verdict: 'pass', criterionEvaluated: true, evidence: where + ' produced ' + path }
    }
    return { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'produced-missing' },
      missing: [path],
      next: 'build the product before this tier: mode=present only checks that it exists, and not-built is not broken',
      evidence: where + ' expected ' + path + ', observed present=' + String(seen.present) }
  }
  if (seen.killedBy === 'budget') {
    return { verdict: 'fail', criterionEvaluated: false, cause: { kind: 'budget-timeout' },
      next: 'the prerequisite exhausted its declared budget: fix the prerequisite, or move the budget in the policy (reason/expiry/owner required)',
      evidence: where + ' killedBy=budget budgetMs=' + String(seen.budgetMs === undefined ? 'unknown' : seen.budgetMs) + ' from=' + String(seen.budgetFrom === undefined ? 'unknown' : seen.budgetFrom) + ' after ' + String(seen.ms === undefined ? '?' : seen.ms) + 'ms' }
  }
  if (seen.killedBy === 'external') {
    return { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'external-signal' },
      missing: [String(seen.signal === undefined || seen.signal === null ? 'signal' : seen.signal)],
      next: 're-run when nothing is signalling the process: an external signal judges neither the prerequisite nor its dependents',
      evidence: where + ' killedBy=external signal=' + String(seen.signal === undefined ? 'unknown' : seen.signal) }
  }
  if (seen.killedBy !== undefined && seen.killedBy !== null) {
    return { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'unknown-combination' },
      missing: [String(seen.killedBy)],
      next: 'the runner reported an unknown killedBy - pass budget|external|null and nothing else',
      evidence: where + ' killedBy=' + String(seen.killedBy) }
  }
  const klass = classifyErrno(seen.errorCode)
  if (klass === 'denied' || klass === 'unknown') {
    return { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'unknown-errno' },
      missing: [String(seen.errorCode)],
      next: 'the prerequisite could not be started: grant access, or register the errno class - a prerequisite that never started judges nothing',
      evidence: where + ' errno=' + String(seen.errorCode) + ' class=' + String(klass) }
  }
  if (klass === 'missing') {
    const path = String(seen.path === undefined || seen.path === null ? '(path not given)' : seen.path)
    if (kind === 'in-repo') {
      return { verdict: 'fail', criterionEvaluated: false, cause: { kind: 'requires-abort' },
        missing: [path],
        next: 'restore the in-repo prerequisite: its absence is a defect in this repo, not a machine state',
        evidence: where + ' errno=' + String(seen.errorCode) + ' path=' + path }
    }
    return { verdict: 'cannot-decide', criterionEvaluated: false, cause: { kind: 'external-missing' },
      missing: [path],
      next: 'install the external prerequisite or point it at an existing path: target-not-built is not a failure of this check',
      evidence: where + ' errno=' + String(seen.errorCode) + ' path=' + path }
  }
  if (seen.status === 0) {
    return { verdict: 'pass', criterionEvaluated: true, evidence: where + ' exit=0 after ' + String(seen.ms === undefined ? '?' : seen.ms) + 'ms' }
  }
  return { verdict: 'fail', criterionEvaluated: false, cause: { kind: 'requires-abort' },
    missing: ['exit=' + String(seen.status)],
    next: 'fix the prerequisite: this tier aborts without judging its members, so their invariants were never evaluated',
    evidence: where + ' exit=' + String(seen.status === undefined || seen.status === null ? 'null' : seen.status) + ' after ' + String(seen.ms === undefined ? '?' : seen.ms) + 'ms' }
}

/**
 * The seam. The CLI wires the real spawnSync; fixtures inject a stub, so no fixture has to start
 * a process to prove what the runner reports. The runner never decides - it observes.
 */
export function createRunner({ spawn, now }) {
  if (typeof spawn !== 'function') throw new Error('createRunner needs a spawn function (the CLI wires spawnSync; fixtures inject a stub)')
  const clock = typeof now === 'function' ? now : () => Date.now()
  const run = (argv, options) => {
    const opts = options === undefined ? {} : options
    const started = clock()
    const spawned = spawn(argv[0], argv.slice(1), { cwd: opts.cwd, stdio: opts.stdio === undefined ? 'inherit' : opts.stdio, timeout: opts.timeoutMs, env: opts.env })
    const ms = clock() - started
    const signal = spawned === undefined || spawned === null ? null : (spawned.signal === undefined ? null : spawned.signal)
    const errorCode = spawned === undefined || spawned === null || spawned.error === undefined || spawned.error === null ? null : (spawned.error.code === undefined ? null : spawned.error.code)
    let killedBy = null
    if (errorCode === 'ETIMEDOUT') killedBy = 'budget'
    else if (signal !== null) killedBy = 'external'
    return { argv, cwd: opts.cwd === undefined ? null : opts.cwd, status: spawned === undefined || spawned === null ? null : (spawned.status === undefined ? null : spawned.status), signal, errorCode, killedBy, ms, stdout: spawned === undefined || spawned === null ? undefined : spawned.stdout, stderr: spawned === undefined || spawned === null ? undefined : spawned.stderr }
  }
  return { run }
}
