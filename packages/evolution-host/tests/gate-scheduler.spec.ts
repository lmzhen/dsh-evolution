// @tier fast
// The deterministic fixture for the M3b scheduler (W10 §16.8). Discipline: no real spawn (the
// async seam takes a stub child), no wall-clock assertion (overlap is proven by resolving injected
// promises, not by sleeping), and every case starts from the exported shape.
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { MAX_CONCURRENCY, clampConcurrency, runTasks } from '../../scripts/lib-gate-scheduler.mjs'
import { createAsyncRunner } from '../../scripts/lib-run-gates.mjs'

const recordOf = (verdict: string) => ({ verdict })
const defer = () => {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((done) => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }

describe('gate scheduler: the contract shape', () => {
  it('exports the bound and clamps it', () => {
    expect(MAX_CONCURRENCY).toBe(32)
    expect(clampConcurrency(undefined)).toBe(1)
    expect(clampConcurrency('4')).toBe(4)
    expect(clampConcurrency(0)).toBe(1)
    expect(clampConcurrency(999)).toBe(MAX_CONCURRENCY)
  })
})

describe('gate scheduler: needs / after / concurrency / fail-fast', () => {
  it('blocks a task whose need did not pass (and never executes it)', async () => {
    let dependentRan = false
    const outcomes = await runTasks({
      tasks: [
        { id: 'a', execute: async () => recordOf('fail') },
        { id: 'b', needs: ['a'], execute: async () => { dependentRan = true; return recordOf('pass') } },
      ],
      concurrency: 2,
    })
    expect(outcomes.get('a')?.status).toBe('done')
    expect(outcomes.get('b')?.status).toBe('blocked')
    expect(outcomes.get('b')?.deps).toEqual(['a'])
    expect(dependentRan).toBe(false)
  })

  it('after orders but ignores the dependency result', async () => {
    const outcomes = await runTasks({
      tasks: [
        { id: 'a', execute: async () => recordOf('fail') },
        { id: 'b', after: ['a'], execute: async () => recordOf('pass') },
      ],
      concurrency: 2,
    })
    expect(outcomes.get('b')?.status).toBe('done')
    expect(outcomes.get('b')?.record?.verdict).toBe('pass')
  })

  it('runs at most `concurrency` tasks in flight', async () => {
    const started: string[] = []
    const first = defer()
    const second = defer()
    const pending = runTasks({
      tasks: [
        { id: 'a', execute: () => { started.push('a'); return first.promise as Promise<any> } },
        { id: 'b', execute: () => { started.push('b'); return second.promise as Promise<any> } },
        { id: 'c', execute: async () => { started.push('c'); return recordOf('pass') } },
      ],
      concurrency: 2,
    })
    await flush()
    expect(started.sort()).toEqual(['a', 'b'])
    first.resolve(recordOf('pass'))
    second.resolve(recordOf('pass'))
    await pending
    expect(started).toContain('c')
  })

  it('fail-fast skips pending tasks (skipped is never pass)', async () => {
    const outcomes = await runTasks({
      tasks: [
        { id: 'a', execute: async () => recordOf('fail') },
        { id: 'b', execute: async () => recordOf('pass') },
        { id: 'c', execute: async () => recordOf('pass') },
      ],
      concurrency: 1,
      failFast: true,
    })
    expect(outcomes.get('a')?.status).toBe('done')
    expect(outcomes.get('b')?.status).toBe('skipped')
    expect(outcomes.get('c')?.status).toBe('skipped')
  })

  it('a cycle blocks instead of hanging', async () => {
    const outcomes = await runTasks({
      tasks: [
        { id: 'a', needs: ['b'], execute: async () => recordOf('pass') },
        { id: 'b', needs: ['a'], execute: async () => recordOf('pass') },
      ],
      concurrency: 2,
    })
    expect(outcomes.get('a')?.status).toBe('blocked')
    expect(outcomes.get('b')?.status).toBe('blocked')
  })

  it('a dangling need blocks with the unknown id named', async () => {
    const outcomes = await runTasks({ tasks: [{ id: 'a', needs: ['ghost'], execute: async () => recordOf('pass') }] })
    expect(outcomes.get('a')?.status).toBe('blocked')
    expect(outcomes.get('a')?.deps).toEqual(['ghost'])
  })

  it('a throwing executor becomes an error outcome, not a hang', async () => {
    const outcomes = await runTasks({ tasks: [{ id: 'a', execute: async () => { throw new Error('boom') } }] })
    expect(outcomes.get('a')?.status).toBe('error')
    expect(outcomes.get('a')?.error).toContain('boom')
  })
})

describe('createAsyncRunner: observes, never decides', () => {
  const fakeChild = () => {
    const child: any = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    return child
  }

  it('reports exit status and captured output', async () => {
    const child = fakeChild()
    const runner = createAsyncRunner({ spawn: () => { setImmediate(() => { child.stdout.emit('data', 'ok'); child.emit('close', 0, null) }); return child } })
    const observed = await runner.run(['node', 'x'], { cwd: '.' })
    expect(observed.status).toBe(0)
    expect(observed.killedBy).toBe(null)
    expect(String(observed.stdout)).toContain('ok')
  })

  it('classifies an external signal as external (never as a budget kill)', async () => {
    const child = fakeChild()
    const runner = createAsyncRunner({ spawn: () => { setImmediate(() => child.emit('close', null, 'SIGTERM')); return child } })
    const observed = await runner.run(['node', 'x'], {})
    expect(observed.killedBy).toBe('external')
  })
})
