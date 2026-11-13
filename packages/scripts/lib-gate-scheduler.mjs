#!/usr/bin/env node
/**
 * lib-gate-scheduler — the bounded-concurrency task graph behind `run-gates` (W10 M3b).
 *
 * Injected, deterministic and total:
 *   runTasks({ tasks, concurrency, failFast, onStatus }) -> Promise<Map<id, outcome>>
 *     task: { id, needs?: string[], after?: string[], execute: () => Promise<record> }
 *     outcome: { id, status: 'done' | 'blocked' | 'skipped', record?, deps? }
 *
 * Semantics (the contract the acceptance fixture pins):
 *   - needs: a HARD dependency. If any dependency's verdict is not 'pass', this task is blocked:
 *     status='blocked', it never executes, and its record (built by the caller) is cannot-decide.
 *     A dependency that cannot be found is blocked too - a dangling edge judges nothing.
 *   - after: ordering only. The task waits, but the dependency's verdict is ignored.
 *   - concurrency: at most N tasks in flight (clamped to [1, 32]); default 1 = the old serial loop.
 *   - failFast: after the first task records verdict 'fail', no NEW task starts; pending tasks are
 *     'skipped' (never 'pass'). In-flight tasks still finish so their observations are not lost.
 *   - A cycle (or any state where nothing can start and nothing is running) blocks the remainder
 *     instead of hanging: 'blocked' with the unresolved dependency ids named.
 *
 * The scheduler does no IO, spawns nothing and reads no clock: `execute` owns all of that.
 */

export const MAX_CONCURRENCY = 32

export function clampConcurrency(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(parsed)))
}

/**
 * @param {{ tasks: Array<{id: string, needs?: string[], after?: string[], execute: () => Promise<any>}>, concurrency?: number, failFast?: boolean, onStatus?: (outcome: any) => void }} options
 * @returns {Promise<Map<string, {id: string, status: 'done'|'blocked'|'skipped', record?: any, deps?: string[]}>>}
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
