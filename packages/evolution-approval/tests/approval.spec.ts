import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionApproval from '../src/index.ts'

describe('EvolutionApproval service', () => {
  it('stages background writes and replays them through a registered runner', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    let executed = false
    ctx.evolutionApproval.registerRunner('memory', async () => {
      executed = true
      return { ok: true, message: 'memory applied' }
    })

    const decision = await ctx.evolutionApproval.request({
      kind: 'memory',
      summary: 'add memory',
      args: { action: 'add', target: 'memory', facts: 'user prefers concise' },
      origin: 'background_review',
    })
    expect(decision.action).toBe('staged')
    expect(decision.pendingId).toBeDefined()

    const approved = await ctx.evolutionApproval.approve(decision.pendingId!)
    expect(approved.ok).toBe(true)
    expect(executed).toBe(true)

    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
})
