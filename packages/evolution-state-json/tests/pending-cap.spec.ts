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
    await rm(root, { recursive: true, force: true })
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
    await rm(root, { recursive: true, force: true })
  })
})
