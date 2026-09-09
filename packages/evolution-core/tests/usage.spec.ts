import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyCuratorFields, emptyRecord, foldCuratorFields, getRecord, loadSuppressedNames, loadUsage, mutateUsage, nodeEvolutionIo, normalizeUsageRecord, updateSuppressedNames, usageFile } from '@deepseek-ai/dsh-evolution-core'
describe('usage sidecar field normalization (P2-3)', () => {
  it('A2-4 (v18): the lifecycle fold is compare-and-set on the run-start state', () => {
    const make = (state: 'active' | 'stale' | 'archived') => ({ ...emptyRecord(), state, archived_at: state === 'archived' ? '2026-01-01T00:00:00.000Z' : null })
    const curated = new Map([['a', make('stale')]])
    // The disk moved to `archived` after this run read `active` — a concurrent
    // curator's archive must win, not be reverted to this run's stale snapshot.
    const disk = new Map([['a', make('archived')]])
    expect(foldCuratorFields(disk, curated, new Set(['a']), new Map([['a', 'active']]))).toEqual(['a'])
    expect(disk.get('a')?.state).toBe('archived')
    // A matching run-start state still folds the lifecycle pair.
    const disk2 = new Map([['a', make('active')]])
    expect(foldCuratorFields(disk2, curated, new Set(['a']), new Map([['a', 'active']]))).toEqual([])
    expect(disk2.get('a')?.state).toBe('stale')
    // A name this run did NOT transition folds only the meta pair (H-1 intact).
    const disk3 = new Map([['a', make('archived')]])
    expect(foldCuratorFields(disk3, curated, new Set(), new Map([['a', 'active']]))).toEqual([])
    expect(disk3.get('a')?.state).toBe('archived')
  })

  it('V6-20: a top-level ARRAY sidecar reads as empty — no phantom "0"/"1" records (0.3.37)', async () => {
    // `Object.entries([...])` produced "0"/"1" phantom skill records and the
    // RMW would persist them as an object map — the one guard the entry
    // shapes all had but the top level lacked.
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-array-'))
    await writeFile(join(root, 'usage.json'), JSON.stringify([{ created_by: 'agent' }, { created_by: 'agent' }]), 'utf8')
    const map = await loadUsage(root, nodeEvolutionIo())
    expect(map.size).toBe(0)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  it('falls back to the emptyRecord baseline for mistyped fields', () => {
    const record = normalizeUsageRecord({
      use_count: '3',
      view_count: null,
      patch_count: Number.NaN,
      created_at: 42,
      pinned: 'yes',
      state: 'archived',
      last_used_at: 7,
      quality_score: 'high',
      created_by: 'agent',
    })
    // Counters and flags revert to their baseline; only the declared types
    // pass through, so NaN can never reach the quality math.
    expect(record).toMatchObject({
      created_by: 'agent',
      use_count: 0,
      view_count: 0,
      patch_count: 0,
      pinned: false,
      state: 'archived',
      last_used_at: null,
      quality_score: undefined,
      quality_warn: undefined,
    })
    // An unknowable age anchors at now (first-sight defer semantics).
    expect(typeof record.created_at).toBe('string')
  })

  it('C-09: negative counters fall back to the zero baseline instead of poisoning quality math', () => {
    const record = normalizeUsageRecord({ use_count: -3, view_count: -1, patch_count: -0.5 })
    expect(record.use_count).toBe(0)
    expect(record.view_count).toBe(0)
    expect(record.patch_count).toBe(0)
    // Legit non-negative finite counters still pass through untouched.
    const ok = normalizeUsageRecord({ use_count: 2, view_count: 0 })
    expect(ok.use_count).toBe(2)
    expect(ok.view_count).toBe(0)
  })

  it('garbage timestamps fall back instead of propagating Invalid Date (N-3)', () => {
    const record = normalizeUsageRecord({
      created_at: 'not-a-date',
      last_used_at: '2026-13-99',
      last_viewed_at: 'not a date either',
      last_patched_at: '2026-01-01T00:00:00.000Z',
      archived_at: 'garbage',
    })
    // A garbage created_at anchors the age clock at now (finite ISO); null is
    // still valid for the optional activity stamps.
    expect(Number.isFinite(Date.parse(record.created_at))).toBe(true)
    expect(record.last_used_at).toBeNull()
    expect(record.last_viewed_at).toBeNull()
    expect(record.last_patched_at).toBe('2026-01-01T00:00:00.000Z')
    expect(record.archived_at).toBeNull()
  })

  it('keeps well-typed records byte-for-byte intact', () => {
    const good = {
      created_by: 'agent',
      created_at: '2026-01-01T00:00:00.000Z',
      use_count: 2,
      view_count: 1,
      patch_count: 3,
      last_used_at: '2026-02-02T00:00:00.000Z',
      last_viewed_at: null,
      last_patched_at: null,
      state: 'stale',
      pinned: true,
      archived_at: null,
      quality_score: 0.5,
      quality_warn: true,
    }
    expect(normalizeUsageRecord(good)).toEqual(good)
  })

  it('loadUsage repairs a corrupted sidecar without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-usage-'))
    await writeFile(usageFile(root), JSON.stringify({
      'broken-skill': { use_count: 'many' },
      'good-skill': { created_by: 'agent', created_at: '2026-01-01T00:00:00.000Z', use_count: 4 },
    }))
    const usage = await loadUsage(root, nodeEvolutionIo())
    expect(usage.get('broken-skill')?.use_count).toBe(0)
    expect(usage.get('good-skill')?.use_count).toBe(4)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('suppression merge must never resurrect a concurrently deleted name (rc.52 regression)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-suppressed-'))
    const io = nodeEvolutionIo()
    // Disk starts with {deleted-skill, keep-skill}.
    await updateSuppressedNames(root, io, (current) => {
      current.add('deleted-skill')
      current.add('keep-skill')
    })
    // A concurrent restore deletes `deleted-skill` from the sidecar.
    await updateSuppressedNames(root, io, (current) => {
      current.delete('deleted-skill')
    })
    // The curator's save merges ONLY its own run-added delta ("new-skill");
    // a full-set union would re-add deleted-skill.
    await updateSuppressedNames(root, io, (current) => {
      current.add('new-skill')
    })
    const names = await loadSuppressedNames(root, io)
    expect(names.has('deleted-skill')).toBe(false)
    expect(names.has('keep-skill')).toBe(true)
    expect(names.has('new-skill')).toBe(true)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('mutateUsage runs an atomic read-modify-write where concurrent bumps are preserved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-mutate-'))
    const io = nodeEvolutionIo()
    await Promise.all(Array.from({ length: 8 }, () => mutateUsage(root, io, (map) => {
      const record = getRecord(map, 'atomic-skill')
      record.use_count += 1
    })))
    const usage = await loadUsage(root, io)
    expect(usage.get('atomic-skill')?.use_count).toBe(8)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('applyCuratorFields copies exactly the curator-owned field set (rc.67 K-2)', () => {
    const disk = { ...emptyRecord(), use_count: 7, view_count: 2, patch_count: 1 }
    const curated = {
      ...emptyRecord(),
      state: 'archived' as const,
      archived_at: '2026-01-01T00:00:00.000Z',
      quality_score: 0.2,
      quality_warn: true,
      pinned: true,
      use_count: 999,
      view_count: 999,
    }
    applyCuratorFields(disk, curated)
    expect(disk.use_count).toBe(7)
    expect(disk.view_count).toBe(2)
    expect(disk.patch_count).toBe(1)
    expect(disk).toMatchObject({
      state: 'archived',
      archived_at: '2026-01-01T00:00:00.000Z',
      quality_score: 0.2,
      quality_warn: true,
      pinned: true,
    })
  })

  it('foldCuratorFields keeps tool-side counters while applying curated lifecycle fields (rc.67 K-2)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-fold-'))
    const io = nodeEvolutionIo()
    // The disk record carries a tool-side bump that landed AFTER the curator's
    // run-start snapshot; the fold must keep it under the curated state.
    await mutateUsage(root, io, (map) => {
      const record = getRecord(map, 'lifecycle-skill')
      record.use_count = 5
    })
    const curated = new Map([['lifecycle-skill', { ...emptyRecord(), state: 'stale' as const, quality_score: 0.3, quality_warn: true }]])
    await mutateUsage(root, io, (map) => { foldCuratorFields(map, curated) })
    const usage = await loadUsage(root, io)
    expect(usage.get('lifecycle-skill')).toMatchObject({ use_count: 5, state: 'stale', quality_score: 0.3, quality_warn: true })
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('a state-ownership set never reverts a concurrent lifecycle write (rc.72 H-1)', () => {
    const disk = new Map([['x', { ...emptyRecord(), use_count: 9, state: 'archived' as const, archived_at: '2026-02-02T00:00:00.000Z' }]])
    // A concurrent curator run archived X AFTER this run's snapshot; this run
    // never transitioned X, so the lifecycle pair must stay untouched — meta
    // (quality) is still refreshed tree-wide.
    const curated = new Map([['x', { ...emptyRecord(), state: 'stale' as const, quality_score: 0.4 }]])
    foldCuratorFields(disk, curated, new Set(['other']))
    expect(disk.get('x')).toMatchObject({
      use_count: 9,
      state: 'archived',
      archived_at: '2026-02-02T00:00:00.000Z',
      quality_score: 0.4,
    })
  })

  it('a malformed sidecar is never overwritten by the RMW (P3)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-malformed-'))
    const io = nodeEvolutionIo()
    await io.writeText(usageFile(root), '{corrupted telemetry')
    await mutateUsage(root, io, (map) => {
      const record = getRecord(map, 'should-not-persist')
      record.use_count = 1
    })
    expect(await io.readText(usageFile(root))).toBe('{corrupted telemetry')
    await io.writeText(join(root, '.curator-suppressed.json'), 'not-json either')
    await updateSuppressedNames(root, io, (names) => { names.add('x') })
    expect(await io.readText(join(root, '.curator-suppressed.json'))).toBe('not-json either')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})

describe('v17: mutateUsage preserves wrong-shape sidecars', () => {
  it('P3 (v17): a top-level ARRAY sidecar is preserved verbatim by mutateUsage (no {} overwrite)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-shape-'))
    const io = nodeEvolutionIo()
    const file = usageFile(root)
    const original = '[ "legacy array shape" ]'
    await writeFile(file, original, 'utf8')
    await mutateUsage(root, io, (map) => {
      map.set('demo', { ...emptyRecord(), created_by: 'agent', created_at: '2026-01-01T00:00:00.000Z' })
    })
    // The wrong-shape bytes are PRESERVED (never overwritten with {}), and
    // reading still yields an empty map (no phantom records).
    const after = await import('node:fs/promises').then(m => m.readFile(file, 'utf8'))
    expect(after).toBe(original)
    expect((await loadUsage(root, io)).size).toBe(0)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
