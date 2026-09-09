import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Storage, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import * as DomainFacility from '@deepseek-ai/dsh-storage-domain'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import * as DomainState from '../src/index.ts'

async function mount(home: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('test-json', new JsonStorageBackend(home))
  ctx.provide(storageBackendServiceKey('test-json'), new JsonStorageBackend(home))
  await ctx.plugin(DomainFacility, { backend: 'test-json' })
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(DomainState)
  return ctx
}

describe('evolution-state-domain transactCuratorState null semantics (G2.1, F-202)', () => {
  it('seeds a missing key when the task returns a record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    expect(await provider.loadCuratorState()).toBeNull()
    await provider.transactCuratorState(() => ({ lastRunAt: 1, runCount: 0, lastSummary: 'a', paused: false }))
    expect(await provider.loadCuratorState()).toEqual({ lastRunAt: 1, runCount: 0, lastSummary: 'a', paused: false })
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('a null return on a missing key keeps the record absent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc2-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.transactCuratorState(() => null)
    expect(await provider.loadCuratorState()).toBeNull()
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('a null return keeps an existing record unchanged', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc3-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(() => null)
    expect((await provider.loadCuratorState())?.lastSummary).toBe('orig')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('a returning task overwrites the existing record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc4-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.saveCuratorState({ lastRunAt: 1, runCount: 5, lastSummary: 'orig', paused: false })
    await provider.transactCuratorState(current => ({ ...current!, lastSummary: 'new', runCount: 6 }))
    expect((await provider.loadCuratorState())?.lastSummary).toBe('new')
    expect((await provider.loadCuratorState())?.runCount).toBe(6)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})

describe('evolution-state-domain pendingSchema origin/sessionId (G2.3, F-214)', () => {
  it('round-trips origin and sessionId through the medium (not stripped on read)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-o-'))
    // Session A writes the record, then closes.
    let ctx = await mount(home)
    let provider = ctx.evolutionStateStorage.provider('domain')
    await provider.savePending({
      id: 'p-o', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending',
      origin: 'background_review', sessionId: 'sess-1',
    })
    await ctx.fiber.dispose()
    // Session B re-opens the SAME medium — zod must not strip the attribution.
    ctx = await mount(home)
    provider = ctx.evolutionStateStorage.provider('domain')
    const record = (await provider.listPending('pending')).find(r => r.id === 'p-o')
    expect(record?.origin).toBe('background_review')
    expect(record?.sessionId).toBe('sess-1')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('reads undefined origin/sessionId for a record that never set them', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-o2-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.savePending({ id: 'p-x', kind: 'skill', summary: 'y', args: {}, createdAt: 'now', status: 'pending' })
    const record = (await provider.listPending('pending')).find(r => r.id === 'p-x')
    expect(record?.origin).toBeUndefined()
    expect(record?.sessionId).toBeUndefined()
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})

describe('evolution-state-domain releasePendingClaim missing-key (G2.7, F-332)', () => {
  it('is a no-op that does not throw on a missing id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-rel-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await expect(provider.releasePendingClaim('nope', 'claim-x')).resolves.toBeUndefined()
    expect(await provider.listPending('pending')).toHaveLength(0)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})

describe('P2-4: transactCuratorState missing-key optimistic retry', () => {
  /** A minimal fake storageDomain facility whose curator_state table replays
   * a scripted missing-key race: the FIRST update rejects missing-key, the
   * concurrent first-writer's record lands in the window, and the retry must
   * run the task on THAT fresh basis. */
  async function mountRacy(update1SeedsThirdParty: boolean) {
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    const records = new Map<string, Record<string, unknown>>()
    const counters = { updates: 0, puts: 0 }
    const thirdParty = { lastRunAt: 100, runCount: 7, lastSummary: 'third-party', paused: false }
    ctx.provide('storageDomain', {
      open: async () => ({
        table: () => ({
          get: async (key: string) => records.get(key) ?? null,
          put: async (key: string, value: unknown) => {
            counters.puts += 1
            records.set(key, value as Record<string, unknown>)
          },
          delete: async (key: string) => records.delete(key),
          entries: () => records.entries(),
          update: async (key: string, fn: (current: never) => never) => {
            counters.updates += 1
            if (counters.updates === 1) {
              if (update1SeedsThirdParty) {
                // The race window: a concurrent first-writer seeds the key
                // between our failed update and our retry.
                records.set(key, thirdParty)
              }
              throw new DomainFacility.DomainError('missing-key', `no record '${key}' to update`)
            }
            if (!records.has(key)) throw new DomainFacility.DomainError('missing-key', `no record '${key}' to update`)
            const next = fn(records.get(key) as never) as Record<string, unknown>
            records.set(key, next)
            return next
          },
        }),
        close: async () => {},
      }) as never,
    })
    await ctx.plugin(DomainState)
    return { ctx, provider: ctx.evolutionStateStorage.provider('domain'), records, counters }
  }

  it('retries the atomic update so a concurrent first-writer is NOT overwritten by the seed', async () => {
    const { provider, records, counters } = await mountRacy(true)
    await provider.transactCuratorState(current => ({
      ...(current ?? { lastRunAt: 0, runCount: 0, lastSummary: '', paused: false }),
      lastSummary: 'mine',
    }))
    // The retry ran the task on the THIRD PARTY's basis: their runCount and
    // lastRunAt survive the merge. The old bare-put shape rebuilt the record
    // from a stale null basis and silently dropped their fields.
    const final = records.get('primary')
    expect(final?.lastSummary).toBe('mine')
    expect(final?.runCount).toBe(7)
    expect(final?.lastRunAt).toBe(100)
    expect(counters.updates).toBe(2)
    expect(counters.puts).toBe(0)
  })

  it('seeds via put only when the key is STILL missing after the retry', async () => {
    const { provider, records, counters } = await mountRacy(false)
    await provider.transactCuratorState(() => ({ lastRunAt: 1, runCount: 0, lastSummary: 'seeded', paused: false }))
    expect(records.get('primary')).toEqual({ lastRunAt: 1, runCount: 0, lastSummary: 'seeded', paused: false })
    expect(counters.updates).toBe(2)
    expect(counters.puts).toBe(1)
  })
})

describe('V15 pending-table bound and claim-scoped resolve', () => {
  const record = (id: string, status: 'pending' | 'approved' | 'rejected', resolvedAt?: string) => ({
    id, kind: 'skill' as const, summary: `s ${id}`, args: {}, createdAt: '2026-01-01T00:00:00Z',
    status, ...(resolvedAt ? { resolvedAt } : {}),
  })

  it('E1 (v15): claim-scoped resolve refuses a foreign claim (same rule as json)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc4-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    await provider.savePending(record('p1', 'pending'))
    const claimed = await provider.claimPending('p1', 'claim-a')
    expect(claimed?.status).toBe('executing')
    // A foreign claimId cannot resolve it; the owner can.
    const foreign = await provider.tryResolvePending('p1', 'approved', 'claim-b')
    expect(foreign.applied).toBe(false)
    expect((await provider.listPending('executing')).some(r => r.id === 'p1')).toBe(true)
    const owner = await provider.tryResolvePending('p1', 'approved', 'claim-a')
    expect(owner.applied).toBe(true)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('P2-4 (v15)/v16: the cap counts RESOLVED records only — pending rows never shrink the audit budget', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc5-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    // 199 resolved records (resolvedAt ascending) — one below the cap.
    for (let i = 0; i < 199; i += 1) {
      await provider.savePending(record(`p${i}`, 'approved', new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()))
    }
    // Resolving the 200th stays within the cap (nothing evicted).
    await provider.savePending(record('p199', 'pending'))
    expect((await provider.tryResolvePending('p199', 'approved')).applied).toBe(true)
    expect(await provider.listPending('approved')).toHaveLength(200)
    // The 201st resolve crosses the cap. P2 (v16): the budget is the RESOLVED
    // count — the concurrent PENDING row does not enlarge the eviction, so
    // exactly ONE resolved record (the oldest, p0) is evicted. (The v15 first
    // cut used the whole-table length here and over-evicted two.)
    await provider.savePending(record('live', 'pending'))
    await provider.savePending(record('p200', 'pending'))
    expect((await provider.tryResolvePending('p200', 'approved')).applied).toBe(true)
    const resolved = await provider.listPending('approved')
    expect(resolved).toHaveLength(200)
    expect(resolved.some(r => r.id === 'p0')).toBe(false)
    expect(resolved.some(r => r.id === 'p1')).toBe(true)
    expect((await provider.listPending('pending')).some(r => r.id === 'live')).toBe(true)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('P2 (v16): a resolved record without resolvedAt sorts LAST (json parity, never the eviction victim)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-domain-tc6-'))
    const ctx = await mount(home)
    const provider = ctx.evolutionStateStorage.provider('domain')
    // 199 stamped resolved records + ONE decided record with NO resolvedAt
    // (legacy/hand-made shape) = exactly at cap. json keeps unknown-time
    // records longest (MAX_SAFE_INTEGER) — the domain provider must agree.
    for (let i = 0; i < 199; i += 1) {
      await provider.savePending(record(`p${i}`, 'approved', new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()))
    }
    const unknown = { ...record('no-time', 'approved'), resolvedAt: undefined }
    await provider.savePending(unknown)
    // The 201st resolve crosses the cap: the victim must be the OLDEST
    // STAMPED record (p0), never the unknown-time one.
    await provider.savePending(record('pusher', 'pending'))
    expect((await provider.tryResolvePending('pusher', 'approved')).applied).toBe(true)
    const resolved = await provider.listPending('approved')
    expect(resolved).toHaveLength(200)
    expect(resolved.some(r => r.id === 'no-time')).toBe(true)
    expect(resolved.some(r => r.id === 'p0')).toBe(false)
    expect(resolved.some(r => r.id === 'p1')).toBe(true)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
