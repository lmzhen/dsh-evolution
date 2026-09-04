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
  it('ignores a self-reported "never" when the platform service is mounted without a never stance (S3.1, E-22)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-s3a-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    ctx.provide('approval', { overrideOf: () => undefined })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    const staged = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'x', args: {}, origin: 'background_review', sessionId: 's1', sessionPolicy: 'never',
    })
    expect(staged.action).toBe('staged') // the self-report lost; default stands
    await rm(home, { recursive: true, force: true })
  })

  it('allows when the platform service derives "never" even if the caller said "ask" (S3.1, E-22)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-s3b-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    ctx.provide('approval', { overrideOf: () => 'never' })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    const allowed = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'y', args: {}, origin: 'background_review', sessionId: 's1', sessionPolicy: 'ask',
    })
    expect(allowed.action).toBe('allow')
    await rm(home, { recursive: true, force: true })
  })

  it('a crashed approve is never replayed: executing records block approve and reject cleans up (S3.3, E-24)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-s3crash-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    let executions = 0
    ctx.evolutionApproval.registerRunner('memory', async () => { executions += 1; return { ok: true, message: 'ok' } })
    await ctx.evolutionApproval.request({ kind: 'memory', summary: 'x', args: {}, origin: 'background_review' })
    const staged = (await ctx.evolutionApproval.list('pending'))[0]!
    // Simulate the crash: the record is claimed (→ executing) and the process
    // dies before the resolve. The runner never ran in this simulation.
    await ctx.evolutionState.claimPending(staged.id, 'crash-claim')
    const retry = await ctx.evolutionApproval.approve(staged.id)
    expect(retry.ok).toBe(false)
    expect(retry.message).toContain('executing')
    expect(executions).toBe(0) // ALWAYS zero duplication
    // Operator cleanup: reject resolves the executing record without a runner.
    const cleanup = await ctx.evolutionApproval.reject(staged.id)
    expect(cleanup.ok).toBe(true)
    expect(await ctx.evolutionApproval.list('pending').then(rows => rows.length)).toBe(0)
    await rm(home, { recursive: true, force: true })
  })

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
    ctx.evolutionApproval.registerRunner('memory', async (args) => {
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

  it('allows writes without staging when the session policy is never', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-never-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    const decision = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'unattended write', args: { action: 'add', facts: 'x' }, origin: 'foreground', sessionPolicy: 'never',
    })
    expect(decision.action).toBe('allow')
    expect(decision.message).toContain('never')
    // Nothing was staged for an unattended session: no unanswerable tail.
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(0)
    // Default behavior stays: 'ask' still stages.
    const askDecision = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'interactive write', args: { action: 'add', facts: 'y' }, origin: 'foreground', sessionPolicy: 'ask',
    })
    expect(askDecision.action).toBe('staged')

    await rm(home, { recursive: true, force: true })
  })

  it('normalizes approval summaries: truncation, batch label and archive warning', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-summary-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'x'.repeat(300), args: { action: 'add', facts: 'a' }, origin: 'background_review',
    })
    await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'memory batch', args: { operations: [{ action: 'add' }, { action: 'add' }, { action: 'remove' }], target: 'user' }, origin: 'background_review',
    })
    await ctx.evolutionApproval.request({
      kind: 'skill', summary: 'skill delete old-skill', args: { operation: { action: 'delete' }, origin: 'background_review' }, origin: 'background_review',
    })
    const pending = await ctx.evolutionApproval.list('pending')
    const bySummary = (suffix: string) => pending.find(item => item.summary.endsWith(suffix))?.summary
    expect(bySummary('...')).toHaveLength(120)
    expect(pending.some(item => item.summary === 'memory user batch of 3 operations')).toBe(true)
    expect(pending.some(item => item.summary === 'skill delete old-skill (warning: archive)')).toBe(true)

    await rm(home, { recursive: true, force: true })
  })
  it('hasRunner mirrors the runner registry for the P1-9 pre-check', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-hasrunner-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(false)
    const dispose = ctx.evolutionApproval.registerRunner('memory', async () => ({ ok: true, message: 'ok' }))
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(true)
    dispose()
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(false)
    await rm(home, { recursive: true, force: true })
  })

})
