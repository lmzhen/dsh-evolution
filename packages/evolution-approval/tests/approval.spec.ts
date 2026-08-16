import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as JsonState from '@deepseek-ai/dsh-evolution-state-json'
import EvolutionState from '@deepseek-ai/dsh-evolution-state'
import EvolutionApproval from '../src/index.ts'

describe('evolution-approval', () => {
  it('stages background writes, keeps audit records and replays through a registered runner', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    let applied = 0
    ctx.evolutionApproval.registerRunner('memory', async args => {
      applied += 1
      return { ok: true, message: `memory ${JSON.stringify(args)}` }
    })

    const decision = await ctx.evolutionApproval.request({
      kind: 'memory',
      summary: 'remember user name',
      args: { action: 'add', facts: 'name: Ada' },
      origin: 'background_review',
    })
    expect(decision.action).toBe('staged')

    const pending = await ctx.evolutionApproval.list('pending')
    expect(pending).toHaveLength(1)
    const approve = await ctx.evolutionApproval.approve(pending[0]!.id)
    expect(approve.ok).toBe(true)
    expect(applied).toBe(1)
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(0)
    expect(await ctx.evolutionApproval.list('approved')).toHaveLength(1)

    await rm(home, { recursive: true, force: true })
  })

  it('keeps a pending record when the runner fails and retains rejection audit', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-fail-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    ctx.evolutionApproval.registerRunner('memory', async () => ({ ok: false, message: 'replay failed' }))
    const decision = await ctx.evolutionApproval.request({ kind: 'memory', summary: 'fail', args: {}, origin: 'background_review' })
    const failed = await ctx.evolutionApproval.approve(decision.pendingId!)
    expect(failed.ok).toBe(false)
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(1)
    const rejected = await ctx.evolutionApproval.reject(decision.pendingId!)
    expect(rejected.ok).toBe(true)
    expect(await ctx.evolutionApproval.list('rejected')).toHaveLength(1)
    await rm(home, { recursive: true, force: true })
  })

  it('runs the replay exactly once when approve is called concurrently', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-atomic-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    let applied = 0
    ctx.evolutionApproval.registerRunner('memory', async () => {
      await new Promise(resolve => setTimeout(resolve, 25))
      applied += 1
      return { ok: true, message: 'memory applied' }
    })

    const decision = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'atomic approval', args: { action: 'add', facts: 'x' }, origin: 'background_review',
    })
    const [a, b] = await Promise.all([
      ctx.evolutionApproval.approve(decision.pendingId!),
      ctx.evolutionApproval.approve(decision.pendingId!),
    ])
    expect(applied).toBe(1)
    expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1)

    await rm(home, { recursive: true, force: true })
  })
})
