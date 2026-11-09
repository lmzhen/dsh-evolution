import { seedRow } from './support/seed-row.ts'
// @tier pre-tag
import { expect, it, vi } from 'vitest'
import { contentHash, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'
import { tempRoot } from '../../test-support/temp-home.ts'
import {
  loadMergeState, pairKey, rowIdOf, runApproveCommand, runResumeCommand,
  type MergeDecision, type MergeRegistryPort, type MergeRow, type ScanPorts,
} from '../src/index.ts'
import { acquireTargetClaim } from '../src/target-claim.ts'

const AT = '2026-10-20T00:00:00.000Z'
const DECISION: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['a', 'b'], rationale: 'same' }

function row(state: 'pending' | 'fuse'): MergeRow {
  const key = pairKey('a', 'b')
  return { id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state, queue: state === 'pending' ? 'pending' : 'fuse', decision: DECISION, runId: 'parent-run', createdAt: AT, updatedAt: AT }
}

function registry() {
  const calls: string[] = []
  const port: MergeRegistryPort = {
    async begin() { calls.push('begin'); return { id: 'run-1', signal: new AbortController().signal, startedAt: 100 } },
    async stage() { calls.push('stage') },
    async settle(_id, outcome) { calls.push('settle:' + outcome.state) },
  }
  return { port, calls }
}

it('detached approve returns before round2 without holding the commit claim', async () => {
  const home = await tempRoot('dsh-merge-detached-approve-')
  const io = nodeEvolutionIo()
  const row0 = row('pending')
  await seedRow(io, home, row0)
  let release = (): void => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const reg = registry()
  const result = await runApproveCommand({
    io, home, registry: reg.port, rowId: row0.id, platformWrite: true, detached: true, now: () => 1000,
    ports: { async round2() { await gate; return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } },
  })
  expect(result).toMatchObject({ ok: true, accepted: true, runId: 'run-1' })
  await new Promise(resolve => setTimeout(resolve, 10))
  const contender = await acquireTargetClaim(io, home, 'a', 1000)
  expect(contender).not.toBeNull()
  await contender?.release()
  release()
  // The detached body is still running: wait for its definitive completion signal
  // (settle) instead of a fixed 10s race. Windows CI under load can exceed the old
  // polling budget even though the run is healthy.
  await vi.waitFor(async () => {
    expect((await loadMergeState(io, home)).state.rows).toEqual([])
    expect(reg.calls).toContain('settle:succeeded')
  }, { timeout: 20_000, interval: 20 })
})

it('approve does not take the commit claim before commit', async () => {
  const home = await tempRoot('dsh-merge-detached-claim-')
  const io = nodeEvolutionIo()
  const row0 = row('pending')
  await seedRow(io, home, row0)
  const held = await acquireTargetClaim(io, home, 'a', 1000)
  const reg = registry()
  const result = await runApproveCommand({ io, home, registry: reg.port, rowId: row0.id, platformWrite: true, now: () => 1000, ports: { async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } } })
  expect(result).toMatchObject({ ok: true })
  expect(reg.calls[0]).toBe('begin')
  await held?.release()
})

it('resume fuse does not take the commit claim', async () => {
  const home = await tempRoot('dsh-merge-detached-resume-claim-')
  const io = nodeEvolutionIo()
  const row0 = row('fuse')
  await seedRow(io, home, row0)
  const held = await acquireTargetClaim(io, home, 'a', 1000)
  const reg = registry()
  const ports: ScanPorts = { async screening() { return [{ a: 'a', b: 'b' }] }, async round1() { return { kind: 'keep' } }, async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } }
  const result = await runResumeCommand({ io, home, registry: reg.port, ports, rowId: row0.id, platformWrite: true, now: () => 1000 })
  expect(result).toMatchObject({ ok: true })
  expect(reg.calls).toContain('begin')
  await held?.release()
})

it('detached resume returns before round2 and completes in background', { timeout: 90_000 }, async () => {
  const home = await tempRoot('dsh-merge-detached-resume-')
  const io = nodeEvolutionIo()
  const row0 = row('fuse')
  await seedRow(io, home, row0)
  const reg = registry()
  const result = await runResumeCommand({
    io, home, registry: reg.port, rowId: row0.id, platformWrite: true, detached: true, now: () => 1000,
    ports: { async screening() { return [{ a: 'a', b: 'b' }] }, async round1() { return { kind: 'keep' } }, async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } },
  })
  expect(result).toMatchObject({ ok: true, accepted: true, runId: 'run-1' })
  await vi.waitFor(async () => {
    expect((await loadMergeState(io, home)).state.rows).toEqual([])
    expect(reg.calls).toContain('settle:succeeded')
  }, { timeout: 60_000, interval: 20 })
})

it('releases the claim when registry begin throws', async () => {
  const home = await tempRoot('dsh-merge-detached-begin-fail-')
  const io = nodeEvolutionIo()
  const row0 = row('pending')
  await seedRow(io, home, row0)
  const bad: MergeRegistryPort = {
    async begin() { throw new Error('begin boom') },
    async stage() {},
    async settle() {},
  }
  await expect(runApproveCommand({
    io, home, registry: bad, rowId: row0.id, platformWrite: true, now: () => 1000,
    ports: { async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } },
  })).rejects.toThrow('begin boom')
  const again = await acquireTargetClaim(io, home, 'a', 1000)
  expect(again).not.toBeNull()
  await again?.release()
})

it('reclaims a claim whose holder pid is dead', async () => {
  const home = await tempRoot('dsh-merge-detached-dead-pid-')
  const io = nodeEvolutionIo()
  const first = await acquireTargetClaim(io, home, 'a', 1000)
  expect(first).not.toBeNull()
  const path = join(home, 'merge', 'claims', contentHash('a') + '.json')
  await io.writeText(path, JSON.stringify({ id: 'claim', token: 'dead', expiresAt: 9_999_999_999, pid: 2147483647 }) + '\n')
  const reclaimed = await acquireTargetClaim(io, home, 'a', 2000)
  expect(reclaimed).not.toBeNull()
  await reclaimed?.release()
})

it('claim carries a 30-minute TTL and a stale claim is taken over', async () => {
  const home = await tempRoot('dsh-merge-detached-lease-')
  const io = nodeEvolutionIo()
  const held = await acquireTargetClaim(io, home, 'a', 0)
  expect(held).not.toBeNull()
  expect(await acquireTargetClaim(io, home, 'a', 29 * 60_000)).toBeNull()
  expect(await acquireTargetClaim(io, home, 'a', 31 * 60_000)).not.toBeNull()
  await held?.release()
})

it('non-detached invalid row returns before registry.begin', async () => {
  const home = await tempRoot('dsh-merge-detached-invalid-')
  const io = nodeEvolutionIo()
  const reg = registry()
  const result = await runApproveCommand({ io, home, registry: reg.port, rowId: 'missing', platformWrite: true, now: () => 1000, ports: { async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } } })
  expect(result.ok).toBe(false)
  expect(reg.calls).toEqual([])
})