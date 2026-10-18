import { describe, expect, it } from 'vitest'
import { createSubagentChannel } from '../src/subagent/channel.ts'
import { probeChannelState } from '../src/subagent/readiness.ts'
import { REVIEWER_PRESET_ID } from '../src/composition/preset-ids.ts'

interface Options {
  readonly providerMissing?: boolean
  readonly capability?: boolean
  readonly inherits?: boolean
  readonly parentPreset?: string | null
  readonly result?: Record<string, unknown>
  readonly resultError?: boolean
  readonly startThrow?: boolean
  readonly childMissing?: boolean
}

function harness(options: Options = {}) {
  const log: string[] = []
  let disposed = 0
  const calls: Array<Record<string, unknown>> = []
  const registry = {
    async readDocument() { return { agentPreset: 'standard', content: "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n" } },
    async register() { log.push('register'); return async () => { log.push('release') } },
  }
  const provider = {
    name: 'spawn',
    capabilities: { agentPreset: options.capability !== false },
    inheritsParentContext: options.inherits === true,
  }
  const subagents = {
    getProvider: () => (options.providerMissing === true ? undefined : provider),
    async startActivation(spec: Record<string, unknown>) {
      calls.push(spec)
      log.push('start')
      if (options.startThrow === true) throw new Error('start-boom')
      return {
        childId: 'child-1',
        result: options.resultError === true ? Promise.reject(new Error('result-boom')) : Promise.resolve(options.result ?? { structured: { ok: true }, stopReason: 'completed' }),
        async dispose() { log.push('dispose'); disposed += 1 },
      }
    },
  }
  const agentPresets = {
    composedPreset: () => (options.parentPreset === null ? undefined : (options.parentPreset ?? 'standard')),
    // oxlint-disable-next-line typescript/unbound-method -- fixture delegates to the fake registry; neither method uses `this`
    readDocument: registry.readDocument,
    // oxlint-disable-next-line typescript/unbound-method -- fixture delegates to the fake registry; neither method uses `this`
    register: registry.register,
  }
  const agents = { get: () => (options.childMissing === true ? undefined : { id: 'child-1' }) }
  const ctx = {
    get: (name: string) => ({ subagents, agentPresets, agents } as Record<string, unknown>)[name],
    effect: (run: () => () => void) => { run(); return () => {} },
  }
  return { ctx, calls, log, disposed: () => disposed }
}

const parent = { ctx: { get: () => undefined } } as never

describe('subagent channel (G3-S1/S2)', () => {
  it('runs one activation with the restricted preset and settles ok, disposing once', async () => {
    const h = harness()
    const channel = createSubagentChannel(h.ctx as never)
    const outcome = await channel.run({ parent, label: 'review', promptText: 'task', kind: 'reviewer', allow: ['tool-skill'], timeoutMs: 1_000 })
    expect(outcome).toMatchObject({ kind: 'ok', structured: { ok: true }, childId: 'child-1', stopReason: 'completed' })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toMatchObject({ provider: 'spawn', label: 'review', delivery: 'caller' })
    expect((h.calls[0] as { request: Record<string, unknown> }).request).toMatchObject({ agentPreset: REVIEWER_PRESET_ID, prompt: [{ type: 'text', text: 'task' }] })
    expect(h.disposed()).toBe(1)
    expect(h.log).toEqual(['register', 'start', 'dispose'])
  })

  it('reports no-structured for a non-completed result (diagnostic kept)', async () => {
    const h = harness({ result: { stopReason: 'error', diagnostic: 'child failed' } })
    const outcome = await createSubagentChannel(h.ctx as never).run({ parent, label: 'r', promptText: 't', kind: 'reviewer', allow: ['tool-skill'], outputSchema: { type: 'object' } as never, timeoutMs: 1_000 })
    expect(outcome).toMatchObject({ kind: 'no-structured', childId: 'child-1', stopReason: 'error', diagnostic: 'child failed' })
  })

  it('reports aborted when the activation aborts', async () => {
    const h = harness({ result: { stopReason: 'aborted' } })
    expect(await createSubagentChannel(h.ctx as never).run({ parent, label: 'r', promptText: 't', kind: 'reviewer', allow: ['tool-skill'], timeoutMs: 1_000 })).toEqual({ kind: 'aborted' })
    expect(h.disposed()).toBe(1)
  })

  it('reports unavailable E-323 when the provider/capability/parent preset is missing', async () => {
    const missingProvider = harness({ providerMissing: true })
    expect(await createSubagentChannel(missingProvider.ctx as never).run({ parent, label: 'r', promptText: 't', kind: 'reviewer', allow: ['tool-skill'], timeoutMs: 1_000 })).toMatchObject({ kind: 'unavailable', code: 'E-323' })
    const weak = harness({ capability: false })
    expect(await createSubagentChannel(weak.ctx as never).run({ parent, label: 'r', promptText: 't', kind: 'reviewer', allow: ['tool-skill'], timeoutMs: 1_000 })).toMatchObject({ kind: 'unavailable', code: 'E-323' })
    const noPreset = harness({ parentPreset: null })
    const noPresetOutcome = await createSubagentChannel(noPreset.ctx as never).run({ parent, label: 'r', promptText: 't', kind: 'reviewer', allow: ['tool-skill'], timeoutMs: 1_000 })
    expect(noPresetOutcome).toMatchObject({ kind: 'unavailable', code: 'E-323' })
    expect((noPresetOutcome as { reason?: string }).reason).toContain('parent preset')
    expect(missingProvider.calls).toHaveLength(0)
  })

  it('captures afterResult evidence before dispose', async () => {
    const h = harness()
    const outcome = await createSubagentChannel(h.ctx as never).run({
      parent,
      label: 'r',
      promptText: 't',
      kind: 'reviewer',
      allow: ['tool-skill'],
      timeoutMs: 1_000,
      afterResult: () => { h.log.push('after'); return { report: 'ok' } },
    })
    expect(outcome).toMatchObject({ kind: 'ok', evidence: { report: 'ok' } })
    expect(h.log.indexOf('after')).toBeLessThan(h.log.indexOf('dispose'))
  })

  it('reports unavailable E-323 when activation startup throws that is not a cancellation', async () => {
    const h = harness({ startThrow: true })
    const outcome = await createSubagentChannel(h.ctx as never).run({ parent, label: 'r', promptText: 't', kind: 'reviewer', allow: ['tool-skill'], timeoutMs: 1_000 })
    expect(outcome).toMatchObject({ kind: 'unavailable', code: 'E-323', reason: 'start-boom' })
    expect(h.disposed()).toBe(0)
  })

  it('probes availability and reflects the registry status', async () => {
    const h = harness()
    expect(probeChannelState(h.ctx as never, 'reviewer')).toMatchObject({ kind: 'available', provider: 'spawn', preset: { id: REVIEWER_PRESET_ID, registered: false } })
    const channel = createSubagentChannel(h.ctx as never)
    expect(await channel.prepare({ kind: 'reviewer', allow: ['tool-skill'] })).toMatchObject({ kind: 'available' })
    expect(await channel.prepare({ kind: 'reviewer', allow: [] })).toMatchObject({ kind: 'unavailable', code: 'E-324' })
  })
})
