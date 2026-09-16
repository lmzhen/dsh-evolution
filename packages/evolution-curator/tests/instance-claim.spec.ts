import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'
import { INSTANCE_KEYS, evolutionHome, instanceHolder } from '@deepseek-ai/dsh-evolution-core'
import { tempHome } from '../../test-support/temp-home.ts'

async function mount(autoStart = false) {
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24, autoStart })
  return ctx
}

// B3 / G4: the curator owns <home>/reports and its retention sweep, which no
// per-file lock serializes. One home therefore admits ONE curator; the second
// instance yields instead of racing it.
describe('evolution-curator single-instance contract', () => {
  it('a second instance over one home yields, and every run says instance-held', async () => {
    await tempHome('dsh-curator-instance-')
    const first = await mount()
    expect(instanceHolder(evolutionHome(), INSTANCE_KEYS.curator)).toBeDefined()

    const ctxB = new Context()
    await ctxB.plugin(EvolutionIoRegistry)
    await ctxB.plugin(NodeIo)
    const warnSpy = vi.spyOn(ctxB.logger, 'warn')
    await ctxB.plugin(EvolutionCurator, { enabled: true, intervalHours: 24, autoStart: true })
    const yielded = warnSpy.mock.calls.map(call => String(call[0])).find(text => text.includes('YIELDS'))
    warnSpy.mockRestore()
    expect(yielded).toContain(evolutionHome())
    expect(yielded).toContain('already held by')

    const outcome = await ctxB.evolutionCurator.run({ ignoreGates: true })
    expect(outcome.skipped).toBe('instance-held')
    expect(outcome.archived).toEqual([])

    // The holder still runs: the yield is the loser's, not the home's.
    const holderOutcome = await first.evolutionCurator.run({ ignoreGates: true })
    expect(holderOutcome.skipped).not.toBe('instance-held')

    await first.fiber.dispose()
    expect(instanceHolder(evolutionHome(), INSTANCE_KEYS.curator)).toBeUndefined()
    const third = await mount()
    const thirdOutcome = await third.evolutionCurator.run({ ignoreGates: true })
    expect(thirdOutcome.skipped).not.toBe('instance-held')
    await third.fiber.dispose()
    await ctxB.fiber.dispose()
  }, 30_000)

  it('one home, one instance: two mounts in ONE context cannot both be granted', async () => {
    await tempHome('dsh-curator-instance-double-')
    const ctx = await mount()
    const holder = instanceHolder(evolutionHome(), INSTANCE_KEYS.curator)
    expect(holder).toBeDefined()
    // A second mount on the SAME context contends for the same key: the claim
    // is per home, so it is refused regardless of which context asks.
    const other = await mount()
    expect(instanceHolder(evolutionHome(), INSTANCE_KEYS.curator)).toBe(holder)
    expect((await other.evolutionCurator.run({ ignoreGates: true })).skipped).toBe('instance-held')
    await ctx.fiber.dispose()
    await other.fiber.dispose()
  }, 30_000)

  it('the yielding row refuses the MANUAL control-plane entries too (PLAN S4.5, audit P2-16)', async () => {
    await tempHome('dsh-curator-instance-manual-')
    const first = await mount()
    const ctxB = new Context()
    await ctxB.plugin(EvolutionIoRegistry)
    await ctxB.plugin(NodeIo)
    await ctxB.plugin(EvolutionCurator, { enabled: true, intervalHours: 24, autoStart: false })
    const yielded = ctxB.evolutionCurator
    // run() refuses (the existing contract)...
    expect((await yielded.run({ ignoreGates: true })).skipped).toBe('instance-held')
    // ...and the three manual entries refuse with the same outcome named, so a
    // yielding row can no longer race the holder row's in-flight control plane
    // over the shared tree (restore/consolidate/restoreSnapshot used to slip
    // past the claim because only run() checked it).
    const restored = await yielded.restore('some-skill')
    expect(restored.ok).toBe(false)
    expect(restored.message).toContain('instance-held')
    const consolidated = await yielded.consolidate('target-skill', ['source-skill'])
    expect(consolidated.ok).toBe(false)
    expect(consolidated.message).toContain('instance-held')
    const rolledBack = await yielded.restoreSnapshot()
    expect(rolledBack.ok).toBe(false)
    expect(rolledBack.message).toContain('instance-held')
    // The holder row is unaffected: its own control plane never sees the claim
    // refusal (this restore fails for the ordinary missing-skill reason).
    const holderRestore = await first.evolutionCurator.restore('missing-skill')
    expect(holderRestore.ok).toBe(false)
    expect(holderRestore.message).not.toContain('instance-held')
    await first.fiber.dispose()
    await ctxB.fiber.dispose()
  }, 30_000)
})
