import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PendingRecord } from '@deepseek-ai/dsh-evolution-state-storage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as JsonState from '../src/index.ts'

async function mount(root: string) {
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root })
  return ctx
}

describe('evolution-state-json pending resolution cap (G2.7, F-336)', () => {
  it('archives the oldest resolved record once the live map exceeds the cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-cap-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')

    const seeded: Record<string, PendingRecord> = {}
    for (let i = 0; i < 200; i += 1) {
      seeded[`seed-${i}`] = {
        id: `seed-${i}`, kind: 'memory', summary: `s${i}`, args: {}, createdAt: 'now',
        status: 'approved', resolvedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
      }
    }
    seeded['keep-pending'] = { id: 'keep-pending', kind: 'skill', summary: 'p', args: {}, createdAt: 'now', status: 'pending' }
    seeded['keep-executing'] = { id: 'keep-executing', kind: 'skill', summary: 'e', args: {}, createdAt: 'now', status: 'executing' }
    seeded['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(seeded))

    const resolved = await provider.tryResolvePending('to-resolve', 'approved')
    expect(resolved.applied).toBe(true)

    const map = JSON.parse(await io.readText(join(root, 'pending-state.json'))) as Record<string, PendingRecord>
    const resolvedIds = Object.values(map).filter(r => r.status === 'approved' || r.status === 'rejected').map(r => r.id)
    expect(resolvedIds).toHaveLength(200)
    expect(resolvedIds).not.toContain('seed-0')
    expect(map['seed-0']).toBeUndefined()
    // The cap never trims live pending/executing work.
    expect(map['keep-pending']?.status).toBe('pending')
    expect(map['keep-executing']?.status).toBe('executing')

    const archive = JSON.parse(await io.readText(join(root, 'pending-state-archive.json'))) as PendingRecord[]
    expect(Array.isArray(archive)).toBe(true)
    expect(archive).toHaveLength(1)
    expect(archive[0].id).toBe('seed-0')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('produces no archive below the cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-cap2-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')

    const seeded: Record<string, PendingRecord> = {}
    for (let i = 0; i < 50; i += 1) {
      seeded[`seed-${i}`] = {
        id: `seed-${i}`, kind: 'memory', summary: `s${i}`, args: {}, createdAt: 'now',
        status: 'approved', resolvedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
      }
    }
    seeded['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(seeded))

    const resolved = await provider.tryResolvePending('to-resolve', 'approved')
    expect(resolved.applied).toBe(true)
    const map = JSON.parse(await io.readText(join(root, 'pending-state.json'))) as Record<string, PendingRecord>
    expect(Object.values(map).filter(r => r.status === 'approved' || r.status === 'rejected')).toHaveLength(51)
    expect(await io.exists(join(root, 'pending-state-archive.json'))).toBe(false)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('dedupes archive entries when the read-only legacy pending.json re-introduces evicted records (V4-01)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-cap-dedup-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')

    // 200 resolved seeds + 10 pending records, all in the LEGACY file. The
    // legacy file is read-merged but never rewritten, so every resolve
    // re-introduces the oldest evicted seeds (seed-0/seed-1...) at the next read.
    const legacy: Record<string, PendingRecord> = {}
    for (let i = 0; i < 200; i += 1) {
      legacy[`seed-${i}`] = {
        id: `seed-${i}`, kind: 'memory', summary: `s${i}`, args: {}, createdAt: 'now',
        status: 'approved', resolvedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
      }
    }
    for (let i = 0; i < 10; i += 1) {
      legacy[`r-${i}`] = { id: `r-${i}`, kind: 'skill', summary: `r${i}`, args: {}, createdAt: 'now', status: 'pending' }
    }
    await io.writeText(join(root, 'pending.json'), JSON.stringify(legacy))

    for (let i = 0; i < 10; i += 1) {
      expect((await provider.tryResolvePending(`r-${i}`, 'approved')).applied).toBe(true)
    }

    const archive = JSON.parse(await io.readText(join(root, 'pending-state-archive.json'))) as PendingRecord[]
    // Without dedupe, each resolve re-archives seed-0/seed-1 (they keep coming
    // back from legacy) and the sidecar grows without bound. With dedupe each
    // seed is archived exactly once.
    expect(Array.isArray(archive)).toBe(true)
    expect(archive).toHaveLength(10)
    expect(archive.map(record => record.id)).toEqual(Array.from({ length: 10 }, (_, i) => `seed-${i}`))
    const ids = archive.map(record => record.id)
    expect(new Set(ids).size).toBe(ids.length)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('rotates the audit sidecar to .bak once it exceeds the archive cap (V4-01)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-cap-rotate-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')

    // Seed the sidecar to the archive cap (5000), oldest-first.
    const seededArchive: PendingRecord[] = []
    for (let i = 0; i < 5000; i += 1) {
      seededArchive.push({
        id: `arch-${i}`, kind: 'memory', summary: `a${i}`, args: {}, createdAt: 'now',
        status: 'approved', resolvedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
      })
    }
    await io.writeText(join(root, 'pending-state-archive.json'), JSON.stringify(seededArchive))

    // Live map at the pending cap; resolving one more forces a single eviction.
    const map: Record<string, PendingRecord> = {}
    for (let i = 0; i < 200; i += 1) {
      map[`live-${i}`] = {
        id: `live-${i}`, kind: 'skill', summary: `l${i}`, args: {}, createdAt: 'now',
        status: 'approved', resolvedAt: new Date(Date.UTC(2021, 0, 1, 0, 0, i)).toISOString(),
      }
    }
    map['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(map))

    expect((await provider.tryResolvePending('to-resolve', 'approved')).applied).toBe(true)

    // Active sidecar restarted from the batch that overflowed it (one record).
    const active = JSON.parse(await io.readText(join(root, 'pending-state-archive.json'))) as PendingRecord[]
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe('live-0')
    // The full pre-rotation history was preserved.
    expect(await io.exists(join(root, 'pending-state-archive.json.bak'))).toBe(true)
    const bak = JSON.parse(await io.readText(join(root, 'pending-state-archive.json.bak'))) as PendingRecord[]
    expect(bak).toHaveLength(5000)
    expect(bak[0].id).toBe('arch-0')
    expect(bak[4999].id).toBe('arch-4999')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('retires a legacy pending.json on first list and never resurrects an archived twin (V5-02)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-retire-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')

    // Upgrade shape: the legacy file holds a pending twin of an id the archive
    // already saw (approved long ago, cap-rotated out of current). Without
    // retirement the rotation re-exposes the stale `pending` copy — claimable
    // and replayed with months-old staged args.
    const legacy: Record<string, PendingRecord> = {
      ghost: { id: 'ghost', kind: 'skill', summary: 'old staged write', args: { facts: 'old' }, createdAt: 'now', status: 'pending' },
    }
    for (let i = 0; i < 199; i += 1) {
      legacy[`seed-${i}`] = {
        id: `seed-${i}`, kind: 'memory', summary: `s${i}`, args: {}, createdAt: 'now',
        status: 'approved', resolvedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
      }
    }
    await io.writeText(join(root, 'pending.json'), JSON.stringify(legacy))
    await io.writeText(join(root, 'pending-state-archive.json'), JSON.stringify([
      { id: 'ghost', kind: 'skill', summary: 'old staged write', args: { facts: 'old' }, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' },
    ]))
    // The live map is already at the cap — no ghost twin resolved in current.
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify({ current: { id: 'current', kind: 'memory', summary: 'c', args: {}, createdAt: 'now', status: 'pending' } }))

    const firstList = await provider.listPending('pending')
    // Retirement ran and renamed the legacy file aside.
    expect(await io.exists(join(root, 'pending.json'))).toBe(false)
    expect(await io.exists(join(root, 'pending.json.migrated'))).toBe(true)
    // The archived twin stays dead: no pending view, no claim.
    expect(firstList.some(record => record.id === 'ghost')).toBe(false)
    await provider.tryResolvePending('current', 'approved')
    expect((await provider.listPending('pending')).some(record => record.id === 'ghost')).toBe(false)
    expect(await provider.claimPending('ghost', 'claimer')).toBeNull()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('evicts by record id even when the map key differs from the id (V5-09)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-evict-key-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')

    const map: Record<string, PendingRecord> = {}
    // Hand-edited file: key != id for the oldest record.
    map['odd-key-oldest'] = { id: 'real-oldest', kind: 'memory', summary: 'o', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' }
    for (let i = 0; i < 199; i += 1) {
      map[`live-${i}`] = { id: `live-${i}`, kind: 'skill', summary: `l${i}`, args: {}, createdAt: 'now', status: 'approved', resolvedAt: new Date(Date.UTC(2021, 0, 1, 0, 0, i)).toISOString() }
    }
    map['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(map))

    await provider.tryResolvePending('to-resolve', 'approved')
    const after = JSON.parse(await io.readText(join(root, 'pending-state.json'))) as Record<string, PendingRecord>
    // The oldest record was archived AND actually left the map (key mismatch must not defeat eviction).
    expect(Object.values(after).some(record => record.id === 'real-oldest')).toBe(false)
    const archive = JSON.parse(await io.readText(join(root, 'pending-state-archive.json'))) as PendingRecord[]
    expect(archive.some(record => record.id === 'real-oldest')).toBe(true)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('collapses historical duplicates inside the archive on load (V5-07)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-dup-collapse-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    // A pre-dedupe-key archive may hold the same id+status+resolvedAt twice —
    // both counted toward the cap forever; a load-time collapse keeps one.
    await io.writeText(join(root, 'pending-state-archive.json'), JSON.stringify([
      { id: 'dup', kind: 'memory', summary: 'd', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' },
      { id: 'dup', kind: 'memory', summary: 'd', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' },
    ]))
    const map: Record<string, PendingRecord> = {}
    for (let i = 0; i < 200; i += 1) {
      map[`live-${i}`] = { id: `live-${i}`, kind: 'skill', summary: `l${i}`, args: {}, createdAt: 'now', status: 'approved', resolvedAt: new Date(Date.UTC(2021, 0, 1, 0, 0, i)).toISOString() }
    }
    map['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'n', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(map))
    await provider.tryResolvePending('to-resolve', 'approved')
    const collapsed = JSON.parse(await io.readText(join(root, 'pending-state-archive.json'))) as PendingRecord[]
    expect(collapsed.filter(record => record.id === 'dup')).toHaveLength(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V6-22: a collapse ALSO lands when the evicted record is already archived (fresh empty, 0.3.37)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-v622-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    // The archive carries a collapsible duplicate pair AND the record this
    // resolve will evict again (a pre-archived ghost still living in the map).
    await io.writeText(join(root, 'pending-state-archive.json'), JSON.stringify([
      { id: 'dup', kind: 'memory', summary: 'd', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' },
      { id: 'dup', kind: 'memory', summary: 'd', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' },
      { id: 'oldest', kind: 'memory', summary: 'o', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' },
    ]))
    const map: Record<string, PendingRecord> = {}
    map['oldest'] = { id: 'oldest', kind: 'memory', summary: 'o', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' }
    for (let i = 0; i < 199; i += 1) {
      map[`live-${i}`] = { id: `live-${i}`, kind: 'skill', summary: `l${i}`, args: {}, createdAt: 'now', status: 'approved', resolvedAt: new Date(Date.UTC(2021, 0, 1, 0, 0, i)).toISOString() }
    }
    map['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'n', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(map))
    await provider.tryResolvePending('to-resolve', 'approved')
    // The eviction appended nothing new (the record was archived already) —
    // pre-fix the collapse-only round returned `current` and left the disk
    // residue forever.
    const once = JSON.parse(await io.readText(join(root, 'pending-state-archive.json'))) as PendingRecord[]
    expect(once.filter(record => record.id === 'dup')).toHaveLength(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V6-30: eviction is by the oldest entry KEYS — a same-id twin keeps its own slot (0.3.37)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-v630-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    const map: Record<string, PendingRecord> = {}
    // Two entries SHARE one id under different keys; only the older one is in
    // the eviction window — it must leave with its own key while the twin
    // stays (pre-fix: both left, one was archived).
    map['twin-old'] = { id: 'shared-id', kind: 'memory', summary: 'old', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' }
    map['twin-new'] = { id: 'shared-id', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'approved', resolvedAt: '2021-01-01T00:00:00.000Z' }
    for (let i = 0; i < 198; i += 1) {
      map[`live-${i}`] = { id: `live-${i}`, kind: 'skill', summary: `l${i}`, args: {}, createdAt: 'now', status: 'approved', resolvedAt: new Date(Date.UTC(2021, 0, 1, 0, 0, i)).toISOString() }
    }
    map['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'n', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(map))
    await provider.tryResolvePending('to-resolve', 'approved')
    const after = JSON.parse(await io.readText(join(root, 'pending-state.json'))) as Record<string, PendingRecord>
    expect('twin-new' in after).toBe(true)
    expect('twin-old' in after).toBe(false)
    const archive = JSON.parse(await io.readText(join(root, 'pending-state-archive.json'))) as PendingRecord[]
    const archivedShared = archive.filter(record => record.id === 'shared-id')
    expect(archivedShared).toHaveLength(1)
    expect(archivedShared[0]?.summary).toBe('old')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V6-01: a mutation BEFORE retirement cannot fixate an archived ghost twin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-v601-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    // Upgrade shape: legacy holds the pending twin of an id the archive saw
    // (its resolved copy was cap-rotated out). The FIRST state operation is a
    // MUTATION (savePending) — before any listPending/retirement.
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      ghost: { id: 'ghost', kind: 'skill', summary: 'old staged write', args: { facts: 'old' }, createdAt: 'now', status: 'pending' },
    }))
    await io.writeText(join(root, 'pending-state-archive.json'), JSON.stringify([
      { id: 'ghost', kind: 'skill', summary: 'old staged write', args: { facts: 'old' }, createdAt: 'now', status: 'approved', resolvedAt: '2020-01-01T00:00:00.000Z' },
    ]))
    await provider.savePending({ id: 'fresh', kind: 'memory', summary: 'n', args: {}, createdAt: 'now', status: 'pending' })
    // The write path applied the same archive exclusion: the ghost twin never
    // reached current, so it can never be claimed + replayed.
    const current = JSON.parse(await io.readText(join(root, 'pending-state.json'))) as Record<string, PendingRecord>
    expect(Object.values(current).some(record => record.id === 'ghost')).toBe(false)
    expect(await provider.claimPending('ghost', 'claimer')).toBeNull()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V7-08: rotation REFRESHES the once-read archive id cache (0.3.44)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-v708-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    // 1) First mutation establishes the once-per-instance archivedIdsCache
    //    (empty archive).
    await provider.savePending({ id: 'first', kind: 'memory', summary: 'n', args: {}, createdAt: 'now', status: 'pending' })
    // 2) Resolving the fresh pending evicts the oldest resolved record and
    //    appends it to the archive — the id the cache never saw (only the
    //    oldest entry leaves; ARCHIVE_RESOLVED_CAP keeps the sidecar small).
    const live: Record<string, PendingRecord> = {}
    for (let i = 0; i < 200; i += 1) {
      live[`live-${i}`] = { id: `live-${i}`, kind: 'skill', summary: `l${i}`, args: {}, createdAt: 'now', status: 'approved', resolvedAt: new Date(Date.UTC(2021, 0, 1, 0, 0, i)).toISOString() }
    }
    live['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(live))
    await provider.tryResolvePending('to-resolve', 'approved')
    // 3) Without the refresh a stale cache excludes NOTHING for the id the
    //    append just added — the ghost twin of `live-0` (now archived) slips
    //    in through a later mutation before any list. The legacy KEY must
    //    match the record id (filterLegacy compares keys against the id set).
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      'live-0': { id: 'live-0', kind: 'skill', summary: 'ghost twin', args: { facts: 'old' }, createdAt: 'now', status: 'pending' },
    }))
    await provider.savePending({ id: 'after-rotate', kind: 'memory', summary: 'n2', args: {}, createdAt: 'now', status: 'pending' })
    const current = JSON.parse(await io.readText(join(root, 'pending-state.json'))) as Record<string, PendingRecord>
    expect(Object.values(current).some(record => record.id === 'live-0')).toBe(false)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('does not write an empty .bak when the archive was empty at rotation (V5-10)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-json-empty-bak-'))
    const ctx = await mount(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')

    const map: Record<string, PendingRecord> = {}
    for (let i = 0; i < 200; i += 1) {
      map[`live-${i}`] = { id: `live-${i}`, kind: 'skill', summary: `l${i}`, args: {}, createdAt: 'now', status: 'approved', resolvedAt: new Date(Date.UTC(2021, 0, 1, 0, 0, i)).toISOString() }
    }
    map['to-resolve'] = { id: 'to-resolve', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'pending' }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(map))
    await provider.tryResolvePending('to-resolve', 'approved')
    // First rotation with an EMPTY archive: no `[]`-backed .bak residue.
    expect(await io.exists(join(root, 'pending-state-archive.json.bak'))).toBe(false)
    const active = JSON.parse(await io.readText(join(root, 'pending-state-archive.json'))) as PendingRecord[]
    expect(active).toHaveLength(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
