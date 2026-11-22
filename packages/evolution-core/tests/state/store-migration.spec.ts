// @tier fast
import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { mountStateStack } from '../../../test-support/state-stack.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { migrateDomainToStore, STATE_MIGRATION_MARKER } from '../../src/state/migrate.ts'
import { createStateStoreProvider } from '../../src/state/store.ts'
import EvolutionState from '../../src/state/index.ts'
import * as StorePlugin from '../../src/state/store-plugin.ts'

async function seeded(): Promise<{ ctx: Awaited<ReturnType<typeof mountStateStack>>; home: string; io: ReturnType<typeof import('../../src/io.ts').nodeEvolutionIo> }> {
  const home = await tempRoot('dsh-state-migrate-')
  const ctx = await mountStateStack(home, { evolution: true })
  const domain = ctx.evolutionStateStorage.provider('domain')
  await domain.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
  await domain.savePending({ id: 'p1', kind: 'memory', summary: 'pending', args: { a: 1 }, createdAt: '2026-01-01T00:00:00.000Z', status: 'pending' })
  await domain.saveCuratorState({ lastRunAt: 10, runCount: 1, lastSummary: 'seed', paused: false })
  return { ctx, home, io: ctx.evolutionIo.provider() }
}

describe('domain → StateStore migration', () => {
  it('copies all three tables, writes the marker, and leaves the domain readable', async () => {
    const { ctx, home, io } = await seeded()
    const result = await migrateDomainToStore(ctx, { io, home })
    expect(result).toMatchObject({ reviewSessions: 1, pending: 1, curator: true, dryRun: false })
    const store = createStateStoreProvider({ io, home })
    expect(await store.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    expect((await store.listPending('pending')).map(row => row.id)).toEqual(['p1'])
    expect(await store.loadCuratorState()).toMatchObject({ lastSummary: 'seed' })
    expect(JSON.parse(await readFile(join(home, 'state', STATE_MIGRATION_MARKER), 'utf8'))).toMatchObject({ source: 'domain', target: 'store', pending: 1 })
    // Rollback path: the domain was not modified by the migration.
    const domain = ctx.evolutionStateStorage.provider('domain')
    expect(await domain.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
  })

  it('refuses to overwrite an existing store', async () => {
    const { ctx, home, io } = await seeded()
    await io.writeText(join(home, 'state', 'store.json'), '{}\n')
    await expect(migrateDomainToStore(ctx, { io, home })).rejects.toThrow(/refusing to overwrite/)
    expect((await ctx.evolutionStateStorage.provider('domain').loadCuratorState())?.lastSummary).toBe('seed')
  })

  it('after migration, auto reads store; deleting the marker rolls back to domain', async () => {
    const previous = process.env.DSH_HOME
    const root = await tempRoot('dsh-state-auto-migration-')
    const evolution = join(root, 'evolution')
    process.env.DSH_HOME = root
    try {
      const ctx = await mountStateStack(evolution, { evolution: true })
      const domain = ctx.evolutionStateStorage.provider('domain')
      await domain.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
      await domain.savePending({ id: 'p1', kind: 'memory', summary: 'pending', args: { a: 1 }, createdAt: '2026-01-01T00:00:00.000Z', status: 'pending' })
      await domain.saveCuratorState({ lastRunAt: 10, runCount: 1, lastSummary: 'seed', paused: false })
      const io = ctx.evolutionIo.provider()
      await migrateDomainToStore(ctx, { io, home: evolution })
      // A fresh process-like context: provider row, then auto.
      const restarted = await mountStateStack(evolution)
      await restarted.plugin(StorePlugin)
      await restarted.plugin(EvolutionState, { provider: 'auto', home: evolution })
      expect(await restarted.evolutionState.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
      expect((await restarted.evolutionState.listPending('pending')).map(row => row.id)).toEqual(['p1'])
      // Rollback is removing the marker: the domain data was never touched.
      await io.remove(join(evolution, 'state', STATE_MIGRATION_MARKER))
      expect(await restarted.evolutionState.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
      expect(await createStateStoreProvider({ io, home: evolution }).loadReviewState('s1')).toMatchObject({ turnsSinceMemory: 1 })
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('serializes a state write against the migration lock', async () => {
    const { ctx, home, io } = await seeded()
    let enteredResolve!: () => void
    const entered = new Promise<void>(resolve => { enteredResolve = resolve })
    let releaseResolve!: () => void
    const gate = new Promise<void>(resolve => { releaseResolve = resolve })
    const delayed = {
      ...io,
      createTextIfAbsent: async (path: string, content: string): Promise<void> => {
        enteredResolve()
        await gate
        if (io.createTextIfAbsent === undefined) throw new Error('fixture io lacks createTextIfAbsent')
        return io.createTextIfAbsent(path, content)
      },
    }
    const migration = migrateDomainToStore(ctx, { io: delayed, home })
    await entered
    let stateSettled = false
    const stateWrite = ctx.evolutionState.loadCuratorState().then(() => { stateSettled = true })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(stateSettled).toBe(false)
    releaseResolve()
    await migration
    await stateWrite
  })

  it('dry-run refuses an existing store instead of reporting a false dry success', async () => {
    const { ctx, home, io } = await seeded()
    await io.writeText(join(home, 'state', 'store.json'), '{}\n')
    await expect(migrateDomainToStore(ctx, { io, home, dryRun: true })).rejects.toThrow(/refusing to overwrite/)
  })

  it('dry-run counts without writing store or marker', async () => {
    const { ctx, home, io } = await seeded()
    const result = await migrateDomainToStore(ctx, { io, home, dryRun: true })
    expect(result).toMatchObject({ reviewSessions: 1, pending: 1, curator: true, dryRun: true })
    expect(await io.exists(join(home, 'state', 'store.json'))).toBe(false)
    expect(await io.exists(join(home, 'state', STATE_MIGRATION_MARKER))).toBe(false)
  })
})
