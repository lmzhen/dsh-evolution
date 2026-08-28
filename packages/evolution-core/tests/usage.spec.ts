import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadUsage, nodeEvolutionIo, normalizeUsageRecord, usageFile } from '@deepseek-ai/dsh-evolution-core'

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
})
