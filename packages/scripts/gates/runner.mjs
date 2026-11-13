#!/usr/bin/env node
/**
 * gates/runner — execution primitives: the bounded-concurrency task graph, the spawn seams and the
 * PURE prerequisite decision. (Formerly lib-gate-scheduler.mjs + lib-run-gates.mjs.)
 *
 * The scheduler does no IO, spawns nothing and reads no clock: `execute` owns all of that. The
 * runner observes (status/signal/killedBy/errno) and never decides; `decideRequires` is the pure
 * matrix the CLI consults for declared prerequisites.
 */

// ---- scheduler ---------------------------------------------------------------------------------
export const MAX_CONCURRENCY = 32

export function clampConcurrency(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(parsed)))
}

/**
 * Run a task graph with bounded concurrency.
 *
 * - needs: a HARD dependency. If its verdict is not 'pass', this task is blocked: it never executes,
 *   and its record (built by the caller) is cannot-decide. A dependency that cannot be found is
 *   blocked too - a dangling edge judges nothing.
 * - after: ordering only. The task waits, but the dependency's verdict is ignored.
 * - concurrency: at most N tasks in flight (clamped to [1, 32]); default 1 = serial.
 * - failFast: after the first task records verdict 'fail', no NEW task starts; pending tasks are
 *   'skipped' (never 'pass'). In-flight tasks still finish so their observations are not lost.
 * - A cycle (nothing startable, nothing running) blocks the remainder instead of hanging.
 *
 * @param {{ tasks: Array<{id: string, needs?: string[], after?: string[], execute: () => Promise<any>}>, concurrency?: number, failFast?: boolean, onStatus?: (outcome: any) => void }} options
 * @returns {Promise<Map<string, {id: string, status: 'done'|'error'|'blocked'|'skipped', record?: any, deps?: string[], error?: string}>>}
 */
export async function runTasks(options) {
  const tasks = Array.isArray(options?.tasks) ? options.tasks : []
  const concurrency = clampConcurrency(options?.concurrency === undefined ? 1 : options.concurrency)
  const failFast = options?.failFast === true
  const onStatus = typeof options?.onStatus === 'function' ? options.onStatus : () => {}
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const outcomes = new Map()
  const order = tasks.map((task) => task.id)
  const running = new Map()
  let failed = false

  const settle = (outcome) => { outcomes.set(outcome.id, outcome); onStatus(outcome) }
  const depsOf = (task) => [...(task.needs ?? []), ...(task.after ?? [])]

  while (outcomes.size < order.length) {
    let startedThisPass = true
    while (startedThisPass && running.size < concurrency) {
      startedThisPass = false
      for (const id of order) {
        if (outcomes.has(id) || running.has(id)) continue
        const task = byId.get(id)
        const deps = depsOf(task)
        const unknown = deps.filter((dep) => !byId.has(dep))
        if (unknown.length > 0) { settle({ id, status: 'blocked', deps: unknown }); startedThisPass = true; continue }
        if (deps.some((dep) => !outcomes.has(dep))) continue
        const failedNeeds = (task.needs ?? []).filter((dep) => outcomes.get(dep)?.record === undefined || outcomes.get(dep).status === 'blocked' || outcomes.get(dep).record.verdict !== 'pass')
        if (failedNeeds.length > 0) { settle({ id, status: 'blocked', deps: failedNeeds }); startedThisPass = true; continue }
        if (failFast && failed) { settle({ id, status: 'skipped' }); startedThisPass = true; continue }
        running.set(id, (async () => {
          let record
          try {
            record = await task.execute()
          } catch (error) {
            running.delete(id)
            settle({ id, status: 'error', error: error instanceof Error ? error.message : String(error) })
            return
          }
          running.delete(id)
          if (record !== null && typeof record === 'object' && record.verdict === 'fail') failed = true
          settle({ id, status: 'done', record })
        })())
        startedThisPass = true
        if (running.size >= concurrency) break
      }
    }
    if (running.size === 0) {
      // Nothing running and nothing startable: the remaining tasks form a cycle (or depend on a
      // blocked chain). Block them all with their unresolved edges named, never hang.
      for (const id of order) {
        if (outcomes.has(id)) continue
        settle({ id, status: 'blocked', deps: depsOf(byId.get(id)).filter((dep) => !outcomes.has(dep) || outcomes.get(dep).status !== 'done') })
      }
      break
    }
    await Promise.race([...running.values()])
  }
  return outcomes
}

// ---- prerequisites -----------------------------------------------------------------------------
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
 * decision fragment, and an unlisted input never throws - it fails closed with unknown-combination.
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
    if (seen.present === true) return { verdict: 'pass', criterionEvaluated: true, evidence: where + ' produced ' + path }
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
  if (seen.status === 0) return { verdict: 'pass', criterionEvaluated: true, evidence: where + ' exit=0 after ' + String(seen.ms === undefined ? '?' : seen.ms) + 'ms' }
  return { verdict: 'fail', criterionEvaluated: false, cause: { kind: 'requires-abort' },
    missing: ['exit=' + String(seen.status)],
    next: 'fix the prerequisite: this tier aborts without judging its members, so their invariants were never evaluated',
    evidence: where + ' exit=' + String(seen.status === undefined || seen.status === null ? 'null' : seen.status) + ' after ' + String(seen.ms === undefined ? '?' : seen.ms) + 'ms' }
}

// ---- spawn seams -------------------------------------------------------------------------------
/** The synchronous seam: the CLI wires spawnSync; fixtures inject a stub. Observes, never decides. */
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

/**
 * The async seam: the scheduler needs concurrent spawns, and concurrency needs a promise-based
 * observation. `killedBy='budget'` is set ONLY by this runner's own timer; an outside signal stays
 * `killedBy='external'`.
 */
export function createAsyncRunner({ spawn, now }) {
  if (typeof spawn !== 'function') throw new Error('createAsyncRunner needs a spawn function (the CLI wires child_process.spawn; fixtures inject a stub)')
  const clock = typeof now === 'function' ? now : () => Date.now()
  const run = (argv, options) => new Promise((resolve) => {
    const opts = options === undefined ? {} : options
    const started = clock()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (status, signal, errorCode) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve({
        argv,
        cwd: opts.cwd === undefined ? null : opts.cwd,
        status,
        signal: signal === undefined ? null : signal,
        errorCode: errorCode === undefined ? null : errorCode,
        killedBy: timedOut ? 'budget' : signal === undefined || signal === null ? null : 'external',
        ms: clock() - started,
        stdout,
        stderr,
      })
    }
    let timer = null
    let child
    try {
      child = spawn(argv[0], argv.slice(1), { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish(null, null, error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'spawn-failed')
      return
    }
    if (opts.timeoutMs !== undefined && opts.timeoutMs !== null && opts.timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM') } catch { /* the close event finishes the observation */ } }, opts.timeoutMs)
    }
    if (child.stdout !== undefined && child.stdout !== null) child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    if (child.stderr !== undefined && child.stderr !== null) child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => finish(null, null, error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'spawn-failed'))
    child.on('close', (status, signal) => finish(status, signal, null))
  })
  return { run }
}
