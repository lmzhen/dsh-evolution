import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'


describe('evolution-state-json transactCuratorState null semantics (G2.1, F-202)', () => {
  it('creates the file when the missing key is seeded by a task that returns a record', async () => {
    const root = await tempRoot('dsh-json-tc-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    expect(await provider.loadCuratorState()).toBeNull()
    await provider.transactCuratorState(() => ({ lastRunAt: 1, runCount: 0, lastSummary: 'a', paused: false }))
    expect(await provider.loadCuratorState()).toEqual({ lastRunAt: 1, runCount: 0, lastSummary: 'a', paused: false })
    expect(await io.exists(join(root, 'curator-state.json'))).toBe(true)
  })

  it('returns null (ensure-absent) on a missing seed and writes no file', async () => {
    const root = await tempRoot('dsh-json-tc2-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await provider.transactCuratorState(() => null)
    expect(await provider.loadCuratorState()).toBeNull()
    expect(await io.exists(join(root, 'curator-state.json'))).toBe(false)
  })

  it('a null return keeps an existing record unchanged', async () => {
    const root = await tempRoot('dsh-json-tc3-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(() => null)
    expect((await provider.loadCuratorState())?.lastSummary).toBe('orig')
    const raw = JSON.parse((await io.readText(join(root, 'curator-state.json')))!) as { primary: { lastSummary: string } }
    expect(raw.primary.lastSummary).toBe('orig')
  })

  it('a returning task overwrites the existing primary record', async () => {
    const root = await tempRoot('dsh-json-tc4-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(current => ({ ...current!, lastSummary: 'new', runCount: 6 }))
    expect((await provider.loadCuratorState())?.lastSummary).toBe('new')
    expect((await provider.loadCuratorState())?.runCount).toBe(6)
  })
})

describe('evolution-state-json transactCuratorState copy hand-off (V27 S4, PLAN S1.3 2026-09-16)', () => {
  it('a task that mutates the record in place and returns null leaves the persisted record unchanged', async () => {
    const root = await tempRoot('dsh-json-tc5-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState((current) => {
      // The task owns its argument (V27 S4): mutating it in place and then
      // refusing the write (null = keep) must not reach the medium — the
      // provider used to hand out the same graph its null path wrote back,
      // so the mutated record was serialized on the "unchanged" path.
      current!.runCount = 999
      current!.paused = true
      return null
    })
    expect(await provider.loadCuratorState()).toEqual({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    const raw = JSON.parse((await io.readText(join(root, 'curator-state.json')))!) as { primary: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } }
    expect(raw.primary).toEqual({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
  })

  it('control: a task returning a fresh object still persists it', async () => {
    const root = await tempRoot('dsh-json-tc6-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(current => ({ ...current!, paused: true }))
    expect(await provider.loadCuratorState()).toEqual({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: true })
    const raw = JSON.parse((await io.readText(join(root, 'curator-state.json')))!) as { primary: { paused: boolean } }
    expect(raw.primary.paused).toBe(true)
  })
})
