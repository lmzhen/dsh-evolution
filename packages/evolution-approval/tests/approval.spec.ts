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
})
