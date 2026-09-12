import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'


describe('evolution-state-json boundaries', () => {
  it('quarantines malformed state files and fails loud instead of wiping them (E-9, 0.3.17)', async () => {
    const root = await tempRoot('dsh-json-boundary-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'review-state.json'), '{not-json')
    await expect(ctx.evolutionStateStorage.provider('json').loadReviewState('s1')).rejects.toThrow(/not valid JSON/)
    // The original bytes are preserved for operator rescue — never overwritten
    // as an empty map (the old contract silently cleared every other record).
    // V10-05 (P2-5): the copy is the FIXED name `<file>.corrupt`.
    const entries = await io.list(root)
    expect(entries).toContain('review-state.json.corrupt')
    expect(await io.readText(join(root, 'review-state.json.corrupt'))).toBe('{not-json')
  })

  it('a save into a corrupt state file rejects and leaves the file untouched (E-9, 0.3.17)', async () => {
    const root = await tempRoot('dsh-json-boundary2-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'pending-state.json'), '{"p1": ')
    const provider = ctx.evolutionStateStorage.provider('json')
    await expect(provider.savePending({
      id: 'p2', kind: 'memory', summary: 'new', args: {}, createdAt: 'now', status: 'pending',
    })).rejects.toThrow(/not valid JSON/)
    expect(await io.readText(join(root, 'pending-state.json'))).toBe('{"p1": ')
  })

  it('claim moves the record to executing; resolve-from-executing and release-to-pending work (S3.3, E-24)', async () => {
    const root = await tempRoot('dsh-json-s3-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    const claimed = await provider.claimPending('p1', 'c1')
    expect(claimed?.status).toBe('executing')
    // Nobody can re-claim (a crashed approve cannot double-execute).
    expect(await provider.claimPending('p1', 'c2')).toBeNull()
    // Resolving from executing is legal (operator or the same approve).
    const resolved = await provider.tryResolvePending('p1', 'rejected')
    expect(resolved.applied).toBe(true)
    // Fresh record: claim → RELEASE rolls executing back to pending (retryable).
    await provider.savePending({ id: 'p2', kind: 'skill', summary: 'y', args: {}, createdAt: 'now', status: 'pending' })
    await provider.claimPending('p2', 'c1')
    await provider.releasePendingClaim('p2', 'c1')
    expect((await provider.listPending('pending')).find(r => r.id === 'p2')?.claimedBy).toBeUndefined()
    expect((await provider.listPending('pending')).find(r => r.id === 'p2')?.status).toBe('pending')
  })

  it('P2-2 (v14): a claim-scoped resolve refuses once the record is no longer ours', async () => {
    const root = await tempRoot('dsh-json-claim-scope-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    await provider.claimPending('p1', 'claim-a')
    // Another writer's claim id cannot resolve the record…
    const foreign = await provider.tryResolvePending('p1', 'approved', 'claim-b')
    expect(foreign.applied).toBe(false)
    expect(foreign.record?.status).toBe('executing')
    // …while the owner's own claim still can.
    const mine = await provider.tryResolvePending('p1', 'approved', 'claim-a')
    expect(mine.applied).toBe(true)
    expect(mine.record?.status).toBe('approved')
    // Unscoped callers (the operator rescue path) keep their behavior.
    await provider.savePending({ id: 'p2', kind: 'memory', summary: 'y', args: {}, createdAt: 'now', status: 'pending' })
    await provider.claimPending('p2', 'claim-a')
    expect((await provider.tryResolvePending('p2', 'rejected')).applied).toBe(true)
  })

  it('reads the legacy pending.json audit file for upgrade continuity', async () => {
    const root = await tempRoot('dsh-json-legacy-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      p1: { id: 'p1', kind: 'memory', summary: 'legacy', args: {}, createdAt: 'old', status: 'pending' },
    }))
    const pending = await ctx.evolutionStateStorage.provider('json').listPending('pending')
    expect(pending.map(record => record.id)).toEqual(['p1'])
  })

  it('V10-05 (P2-5): a corrupt pending-state.json fails loud through the legacy read path — never a silent legacy-only view', async () => {
    const root = await tempRoot('dsh-json-legacy-corrupt-')
    const ctx = await mountStateStack(root)
    const io = ctx.evolutionIo.provider('node')
    // A valid legacy file AND a corrupt current file: the read must surface
    // the corruption (fixed `.corrupt` copy + throw), not quietly degrade to
    // the legacy-only view behind a best-effort catch.
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      p1: { id: 'p1', kind: 'memory', summary: 'legacy', args: {}, createdAt: 'old', status: 'pending' },
    }))
    await io.writeText(join(root, 'pending-state.json'), '{corrupt')
    await expect(ctx.evolutionStateStorage.provider('json').listPending()).rejects.toThrow(/not valid JSON/)
    expect(await io.list(root)).toContain('pending-state.json.corrupt')
    // The corrupt file itself is never rewritten by the failed read.
    expect(await io.readText(join(root, 'pending-state.json'))).toBe('{corrupt')
  })

  it('keeps legacy pending records visible when a new record is saved and can resolve them', async () => {
    const root = await tempRoot('dsh-json-legacy-merge-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'pending.json'), JSON.stringify({
      legacy: { id: 'legacy', kind: 'memory', summary: 'legacy', args: {}, createdAt: 'old', status: 'pending' },
    }))
    await provider.savePending({ id: 'new', kind: 'skill', summary: 'new', args: {}, createdAt: 'now', status: 'pending' })
    expect((await provider.listPending('pending')).map(record => record.id).sort()).toEqual(['legacy', 'new'])

    const first = await provider.tryResolvePending('legacy', 'approved')
    expect(first.applied).toBe(true)
    const second = await provider.tryResolvePending('legacy', 'approved')
    expect(second.applied).toBe(false)
    expect(await provider.listPending('approved')).toHaveLength(1)
    expect(await provider.listPending('pending')).toHaveLength(1)
  })

  it('serializes concurrent state writes without lost updates', async () => {
    const root = await tempRoot('dsh-json-concurrent-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await Promise.all([
      provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 }),
      provider.saveReviewState('s2', { turnsSinceMemory: 2, turnsSinceSkill: 0, lastTurn: 2 }),
      provider.saveCuratorState({ lastRunAt: 1, runCount: 1, lastSummary: 'a', paused: false }),
      provider.saveCuratorState({ lastRunAt: 2, runCount: 2, lastSummary: 'b', paused: false }),
    ])
    expect((await provider.loadReviewState('s1'))?.turnsSinceMemory).toBe(1)
    expect((await provider.loadReviewState('s2'))?.turnsSinceMemory).toBe(2)
    expect((await provider.loadCuratorState())?.lastSummary).toBe('b')
  })

  it('returns the existing record with applied:false on a status mismatch (E-10, 0.3.17 — json provider)', async () => {
    const root = await tempRoot('dsh-json-e10-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.savePending({ id: 'p1', kind: 'memory', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    expect((await provider.tryResolvePending('p1', 'approved')).applied).toBe(true)
    const second = await provider.tryResolvePending('p1', 'rejected')
    expect(second.applied).toBe(false)
    expect(second.record).not.toBeNull()
  })

  it('resolves a pending record exactly once under concurrent resolution', async () => {
    const root = await tempRoot('dsh-json-resolve-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.savePending({ id: 'p1', kind: 'skill', summary: 'x', args: {}, createdAt: 'now', status: 'pending' })
    const [a, b] = await Promise.all([
      provider.tryResolvePending('p1', 'approved'),
      provider.tryResolvePending('p1', 'approved'),
    ])
    expect([a, b].filter(result => result.applied)).toHaveLength(1)
    expect(await provider.listPending('approved')).toHaveLength(1)
  })
})
