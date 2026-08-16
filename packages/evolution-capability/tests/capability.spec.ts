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
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'
import EvolutionCapability, { validateCapabilityPackage } from '../src/index.ts'

const PACKAGE = {
  name: 'demo-capability',
  purpose: 'Demonstrate staged capability governance.',
  code: { host: 'export function apply() {}' },
}

async function mount(enabled: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-capability-'))
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root: join(root, 'state') })
  await ctx.plugin(EvolutionState)
  await ctx.plugin(EvolutionApproval, { enabled, stageForeground: true })
  await ctx.plugin(EvolutionCapability)
  return { ctx, root }
}

describe('evolution-capability', () => {
  it('validates package boundaries without executing code', () => {
    expect(validateCapabilityPackage(PACKAGE).ok).toBe(true)
    expect(validateCapabilityPackage({ ...PACKAGE, name: 'Bad Name' }).ok).toBe(false)
    expect(validateCapabilityPackage({ ...PACKAGE, code: {} }).ok).toBe(false)
    expect(validateCapabilityPackage({ ...PACKAGE, code: { host: 'x'.repeat(70_000) } }).ok).toBe(false)
  })

  it('fails closed when staged approval is disabled', async () => {
    const { ctx, root } = await mount(false)
    const result = await ctx.evolutionCapability.submit(PACKAGE)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('approval')
    expect(await ctx.evolutionCapability.listPending()).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('stages a valid capability package in the pending audit trail', async () => {
    const { ctx, root } = await mount(true)
    const result = await ctx.evolutionCapability.submit(PACKAGE)
    expect(result.ok).toBe(true)
    expect(result.pendingId).toBeTruthy()
    const pending = await ctx.evolutionCapability.listPending('pending')
    expect(pending.map(record => record.kind)).toEqual(['capability'])
    const approved = await ctx.evolutionApproval.approve(result.pendingId!)
    expect(approved.ok).toBe(true)
    expect(approved.message).toContain('manual activation')
    const pkg = await ctx.evolutionCapability.approvedPackage(result.pendingId!)
    expect(pkg).toEqual(PACKAGE)
    await rm(root, { recursive: true, force: true })
  })
})
