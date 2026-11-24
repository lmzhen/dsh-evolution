// @tier fast
import { describe, expect, it, vi } from 'vitest'

// The conformance suite exercises the 220-row pending cap through the public
// seam; each v2 write publishes a commit + head, so the Windows fixture takes
// longer than the default timeout. The contract, not the runner budget, is the
// assertion here.
vi.setConfig({ testTimeout: 180_000 })
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-evolution-platform/values/fs'
import { mountStateStack } from '../../../test-support/state-stack.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { HomeFence } from '../../src/home-fence.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { createStateV2Provider } from '../../src/state/v2-provider.ts'
import { emptyStateDocument } from '../../src/state/document.ts'
import { PROVIDER_STORE_V2, STATE_V2_MIGRATION_MARKER } from '../../src/state/constants.ts'
import { migrateStateToV2 } from '../../src/state/migrate.ts'
import { writeStateStoreSnapshot } from '../../src/state/store.ts'
import { runStateProviderConsistency } from '../../src/state/conformance.ts'
import EvolutionState from '../../src/state/index.ts'

async function seeded(): Promise<{ root: string; io: ReturnType<typeof import('../../src/io.ts').nodeEvolutionIo>; fence: HomeFence }> {
  const root = await tempRoot('dsh-state-v2-')
  const ctx = await mountStateStack(root)
  const io = ctx.evolutionIo.provider()
  const fence = new HomeFence({ home: root })
  const kernel = new StoreKernel({ io, home: root, fence })
  await kernel.bootstrap({ state: emptyStateDocument() })
  return { root, io, fence }
}

describe('MVCC state provider', () => {
  it('passes the shared provider conformance suite', async () => {
    const { root, io, fence } = await seeded()
    const provider = createStateV2Provider({ io, home: root, fence })
    expect(provider.locking).toBe('internal')
    await runStateProviderConsistency(provider, expect)
  })

  it('migrates a v1 store document and auto-selects the v2 provider', async () => {
    const root = await tempRoot('dsh-state-v2-migrate-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider()
    await writeStateStoreSnapshot(io, join(root, 'state', 'store.json'), {
      review: { s1: { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 } },
      curator: { lastRunAt: 10, runCount: 1, lastSummary: 'seed', paused: false },
      pending: { p1: { id: 'p1', kind: 'memory', summary: 'pending', args: {}, createdAt: 'now', status: 'pending' } },
    })
    const migrated = await migrateStateToV2(ctx, { io, home: root })
    expect(migrated.source).toBe('store')
    expect(migrated.commitId).toMatch(/^[0-9a-f]{64}$/)
    const provider = createStateV2Provider({ io, home: root, fence: new HomeFence({ home: root }) })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
    expect((await provider.listPending('pending')).map(record => record.id)).toEqual(['p1'])

    ctx.evolutionStateStorage.registerProvider(provider)
    const previous = process.env.DSH_EVOLUTION_HOME
    process.env.DSH_EVOLUTION_HOME = root
    try {
      await ctx.plugin(EvolutionState, { provider: 'auto' })
      expect(ctx.evolutionState.providerSelection().effective).toBe(PROVIDER_STORE_V2)
    } finally {
      if (previous === undefined) delete process.env.DSH_EVOLUTION_HOME
      else process.env.DSH_EVOLUTION_HOME = previous
    }
  })

  it('migrates the legacy run index into the same first commit', async () => {
    const root = await tempRoot('dsh-state-v2-runs-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider()
    await writeFile(join(root, 'runs.json'), JSON.stringify({
      schemaVersion: 2,
      runs: [{ id: 'run-1', kind: 'maintain', state: 'succeeded', startedAt: 1, endedAt: 2 }],
      foreign: [],
    }) + '\n')
    await migrateStateToV2(ctx, { io, home: root })
    const kernel = new StoreKernel({ io, home: root, fence: new HomeFence({ home: root }) })
    expect((await kernel.query(['runs'])).domains.runs).toMatchObject({
      schemaVersion: 2,
      runs: [{ id: 'run-1', state: 'succeeded' }],
    })
  })

  it('migrates the legacy merge state into the same first commit', async () => {
    const root = await tempRoot('dsh-state-v2-merge-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider()
    await mkdir(join(root, 'merge'), { recursive: true })
    await writeFile(join(root, 'merge', 'merge-state.json'), JSON.stringify({ schemaVersion: 3, rows: [] }) + '\n')
    await migrateStateToV2(ctx, { io, home: root })
    const kernel = new StoreKernel({ io, home: root, fence: new HomeFence({ home: root }) })
    expect((await kernel.query(['merge'])).domains.merge).toEqual({ text: JSON.stringify({ schemaVersion: 3, rows: [] }) + '\n' })
  })

  it('migrates merge run-meta and reports into the same first commit', async () => {
    const root = await tempRoot('dsh-state-v2-aux-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider()
    await mkdir(join(root, 'merge', 'run-meta'), { recursive: true })
    await mkdir(join(root, 'reports'), { recursive: true })
    await writeFile(join(root, 'merge', 'run-meta', 'run-1.json'), '{"phase":"settled"}\n')
    await writeFile(join(root, 'reports', 'maintain-1.json'), '{"ok":true}\n')
    await migrateStateToV2(ctx, { io, home: root })
    const kernel = new StoreKernel({ io, home: root, fence: new HomeFence({ home: root }) })
    const snapshot = await kernel.query(['mergeMeta', 'reports'])
    expect(snapshot.domains.mergeMeta).toEqual({ 'merge/run-meta/run-1.json': '{"phase":"settled"}\n' })
    expect(snapshot.domains.reports).toEqual({ 'reports/maintain-1.json': '{"ok":true}\n' })
  })

  it('migrates usage, suppressed and feedback sidecars into the same first commit', async () => {
    const root = await tempRoot('dsh-state-v2-sidecars-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider()
    const skillsRoot = join(root, 'skills')
    await mkdir(skillsRoot, { recursive: true })
    await writeFile(join(skillsRoot, '.usage.json'), '{"version":1,"skills":{}}\n')
    await writeFile(join(skillsRoot, '.curator-suppressed.json'), '{"version":1,"names":[]}\n')
    await writeFile(join(root, 'feedback.json'), '{"version":2,"lastSeq":0,"skills":{},"sessions":{}}\n')
    await migrateStateToV2(ctx, { io, home: root, skillsRoot })
    const kernel = new StoreKernel({ io, home: root, fence: new HomeFence({ home: root }) })
    const snapshot = await kernel.query(['usage', 'suppressed', 'feedback'])
    expect(snapshot.domains.usage).toEqual({ text: '{"version":1,"skills":{}}\n' })
    expect(snapshot.domains.suppressed).toEqual({ text: '{"version":1,"names":[]}\n' })
    expect(snapshot.domains.feedback).toEqual({ text: '{"version":2,"lastSeq":0,"skills":{},"sessions":{}}\n' })
  })

  it('migrates discovery documents into the same first commit', async () => {
    const root = await tempRoot('dsh-state-v2-discovery-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider()
    await writeFile(join(root, 'domain-map.json'), '{"schemaVersion":1,"mapVersion":"1","updatedAt":1,"domains":[],"edges":[]}\n')
    await writeFile(join(root, 'projection-journal.json'), '{"schemaVersion":1,"records":{}}\n')
    await writeFile(join(root, 'view-snapshots.json'), '{"schemaVersion":1,"sessions":{}}\n')
    await migrateStateToV2(ctx, { io, home: root })
    const kernel = new StoreKernel({ io, home: root, fence: new HomeFence({ home: root }) })
    const snapshot = await kernel.query(['domainMap', 'projectionJournal', 'viewSnapshots'])
    expect(snapshot.domains.domainMap).toEqual({ text: '{"schemaVersion":1,"mapVersion":"1","updatedAt":1,"domains":[],"edges":[]}\n' })
    expect(snapshot.domains.projectionJournal).toEqual({ text: '{"schemaVersion":1,"records":{}}\n' })
    expect(snapshot.domains.viewSnapshots).toEqual({ text: '{"schemaVersion":1,"sessions":{}}\n' })
  })

  it('reads while the legacy state.lock is held because locking is internal', async () => {
    const { root, io, fence } = await seeded()
    const ctx = await mountStateStack(root)
    ctx.evolutionStateStorage.registerProvider(createStateV2Provider({ io, home: root, fence }))
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), JSON.stringify({ target: PROVIDER_STORE_V2 }) + '\n')
    const previous = process.env.DSH_EVOLUTION_HOME
    process.env.DSH_EVOLUTION_HOME = root
    try {
      await ctx.plugin(EvolutionState, { provider: PROVIDER_STORE_V2 })
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const held = withFileLock(join(root, 'state.lock'), async () => { await gate })
      // The legacy lock is held, but the v2 provider must not wait for it.
      const result = await Promise.race([
        ctx.evolutionState.loadCuratorState(),
        new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 750)),
      ])
      expect(result).not.toBe('timeout')
      release()
      await held
    } finally {
      if (previous === undefined) delete process.env.DSH_EVOLUTION_HOME
      else process.env.DSH_EVOLUTION_HOME = previous
    }
  })
})
