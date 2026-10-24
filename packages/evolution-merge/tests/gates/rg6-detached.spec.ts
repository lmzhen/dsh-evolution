// @tier pre-tag
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { loadMergeState, pairKey, rowIdOf, runApproveCommand, runResumeCommand, upsertRow, type MergeDecision, type MergeRegistryPort, type MergeRow } from '../../src/index.ts'
import { mergeStatePath } from '../../src/state.ts'

const AT = '2026-10-20T00:00:00.000Z'
const DECISION: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['a', 'b'], rationale: 'same' }
const row = (): MergeRow => { const key = pairKey('a', 'b'); return { id: rowIdOf(key), pairKey: key, a: 'a', b: 'b', state: 'pending', queue: 'pending', decision: DECISION, createdAt: AT, updatedAt: AT } }
function registry() {
  const calls: string[] = []
  const port: MergeRegistryPort = {
    async begin() { calls.push('begin'); return { id: 'run-1', signal: new AbortController().signal, startedAt: 100 } },
    async stage() { calls.push('stage') },
    async settle(_id, outcome) { calls.push('settle:' + outcome.state) },
  }
  return { port, calls }
}

it('detached approve accepts under 1s and completes without a client', async () => {
  const home = await tempRoot('dsh-rg6-detached-')
  const io = nodeEvolutionIo()
  const planned = row()
  await upsertRow(io, home, () => 1000, planned)
  let release = (): void => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const reg = registry()
  const started = Date.now()
  const result = await runApproveCommand({ io, home, registry: reg.port, rowId: planned.id, platformWrite: true, detached: true, now: () => 1000, ports: { async round2() { await gate; return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } } })
  expect(Date.now() - started).toBeLessThan(1000)
  expect(result).toMatchObject({ ok: true, accepted: true, runId: 'run-1' })
  release()
  for (let i = 0; i < 100 && !reg.calls.includes('settle:succeeded'); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  expect(reg.calls).toContain('settle:succeeded')
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
})

it('detached resume accepts under 1s and completes in background', async () => {
  const home = await tempRoot('dsh-rg6-detached-resume-')
  const io = nodeEvolutionIo()
  const planned = { ...row(), state: 'fuse' as const, queue: 'fuse' as const }
  await upsertRow(io, home, () => 1000, planned)
  const reg = registry()
  const started = Date.now()
  const result = await runResumeCommand({ io, home, registry: reg.port, rowId: planned.id, platformWrite: true, detached: true, now: () => 1000, ports: { async screening() { return [{ a: 'a', b: 'b' }] }, async round1() { return { kind: 'keep' } }, async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } } })
  expect(Date.now() - started).toBeLessThan(1000)
  expect(result).toMatchObject({ ok: true, accepted: true, runId: 'run-1' })
  for (let i = 0; i < 100 && (await loadMergeState(io, home)).state.rows.length > 0; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  expect((await loadMergeState(io, home)).state.rows).toEqual([])
})

it('client disconnect does not abort a detached run', async () => {
  const home = await tempRoot('dsh-rg6-kill-client-')
  const io = nodeEvolutionIo()
  const planned = row()
  await upsertRow(io, home, () => 1000, planned)
  const reg = registry()
  const result = await runApproveCommand({ io, home, registry: reg.port, rowId: planned.id, platformWrite: true, detached: true, now: () => 1000, ports: { async round2() { return { kind: 'merged', unitId: 'u-1', archived: ['b'] } } } })
  expect(result).toMatchObject({ ok: true, accepted: true })
  for (let i = 0; i < 100 && !reg.calls.includes('settle:succeeded'); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  expect(reg.calls).toContain('settle:succeeded')
  expect(createHash('sha256').update(await (await import('node:fs/promises')).readFile(mergeStatePath(home))).digest('hex')).toHaveLength(64)
})
