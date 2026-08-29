import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRecord, loadSuppressedNames, loadUsage, mutateUsage, nodeEvolutionIo, normalizeUsageRecord, updateSuppressedNames, usageFile } from '@deepseek-ai/dsh-evolution-core'

describe('usage sidecar field normalization (P2-3)', () => {
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
    await rm(root, { recursive: true, force: true })
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
    await rm(root, { recursive: true, force: true })
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
    await rm(root, { recursive: true, force: true })
  })
})
