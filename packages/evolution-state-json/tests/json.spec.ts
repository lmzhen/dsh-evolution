import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'

describe('evolution-state-json', () => {
  it('persists review, curator and pending records through the IO seam', async () => {
    const home = await tempRoot('dsh-state-json-')
    const ctx = await mountStateStack(home)
    const provider = ctx.evolutionStateStorage.provider('json')

    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    await provider.saveCuratorState({ lastRunAt: 4, runCount: 5, lastSummary: 'ok', paused: false })
    expect((await provider.loadCuratorState())?.runCount).toBe(5)
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'add', args: {}, createdAt: 'now', status: 'pending' })
    expect(await provider.listPending()).toHaveLength(1)
    expect((await provider.claimPending('p1', 'claim'))?.status).toBe('executing')
    expect(await provider.listPending('executing')).toHaveLength(1)
  })

  it('V24-08: the review-state session cap evicts least-recently-active rows and strips the internal stamp on read', async () => {
    const home = await tempRoot('dsh-state-json-cap-')
    const ctx = await mountStateStack(home)
    const provider = ctx.evolutionStateStorage.provider('json')
    // Seed the file directly with REVIEW_STATE_SESSION_CAP + 1 rows: 500
    // stamped rows (oldest first) plus one PRE-0.3.67 row without a stamp —
    // the stampless row is the stalest by definition and must evict first.
    const io = ctx.evolutionIo.provider('node')
    const map: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < 500; i += 1) {
      map[`old-${i}`] = { turnsSinceMemory: 1, turnsSinceSkill: 1, lastTurn: i, updatedAt: 1000 + i }
    }
    map['legacy-no-stamp'] = { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: 0 }
    await io.writeText(join(home, 'review-state.json'), JSON.stringify(map))
    // One more save pushes the map over the cap: the current session is
    // exempt, the two stalest rows (legacy-no-stamp, old-0) are evicted.
    await provider.saveReviewState('new-session', { turnsSinceMemory: 2, turnsSinceSkill: 3, lastTurn: 1 })
    const onDisk = JSON.parse(await io.readText(join(home, 'review-state.json')) ?? '{}') as Record<string, Record<string, unknown>>
    expect(Object.keys(onDisk)).toHaveLength(500)
    expect(onDisk['legacy-no-stamp']).toBeUndefined()
    expect(onDisk['old-0']).toBeUndefined()
    expect(onDisk['old-499']).toBeDefined()
    expect(onDisk['new-session']).toBeDefined()
    // loadReviewState strips the internal stamp — the consumer-facing record
    // shape is unchanged.
    const loaded = await provider.loadReviewState('new-session')
    expect(loaded).toEqual({ turnsSinceMemory: 2, turnsSinceSkill: 3, lastTurn: 1 })
    // A save refreshes the stamp so an active session survives later sweeps.
    await provider.saveReviewState('old-1', { turnsSinceMemory: 5, turnsSinceSkill: 5, lastTurn: 2 })
    await provider.saveReviewState('another-session', { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: 0 })
    const after = JSON.parse(await io.readText(join(home, 'review-state.json')) ?? '{}') as Record<string, { updatedAt?: number }>
    expect(after['old-1']?.updatedAt).toBeGreaterThan(1001)
  }, 60_000)
})
