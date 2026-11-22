// @tier fast
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { mountStateStack } from '../../../test-support/state-stack.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { migrateDomainToStore, STATE_MIGRATION_MARKER } from '../../src/state/migrate.ts'
import { createStateStoreProvider } from '../../src/state/store.ts'

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

  it('dry-run counts without writing store or marker', async () => {
    const { ctx, home, io } = await seeded()
    const result = await migrateDomainToStore(ctx, { io, home, dryRun: true })
    expect(result).toMatchObject({ reviewSessions: 1, pending: 1, curator: true, dryRun: true })
    expect(await io.exists(join(home, 'state', 'store.json'))).toBe(false)
    expect(await io.exists(join(home, 'state', STATE_MIGRATION_MARKER))).toBe(false)
  })
})
