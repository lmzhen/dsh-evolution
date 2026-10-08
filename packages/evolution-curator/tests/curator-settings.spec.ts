import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator, { validateCuratorSettings } from '../src/index.ts'
import { loadUsage, nodeEvolutionIo, saveUsage } from '@deepseek-ai/dsh-evolution-core'
import type { UsageRecord } from '@deepseek-ai/dsh-evolution-core'
import { mutableVol, vol } from '../../test-support/volatile-config.ts'
import { tempHome } from '../../test-support/temp-home.ts'

// v21 (T-8): restore the real DSH_HOME after EVERY test, success or failure —
// one failing assertion must not leak a temp home into the rest of the worker.
const REAL_DSH_HOME = process.env.DSH_HOME
afterEach(() => {
  if (REAL_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = REAL_DSH_HOME
})

/**
 * The settings service stub: this plugin consults the USER LAYER for KEY NAMES only
 * (G1 §8.4-A) — the values themselves arrive through the row config, because the
 * platform resolves the user layer into it. `publish` moves the user document the
 * way the settings file provider does.
 * @param ctx - the mounting context.
 * @param user - the user document to serve.
 * @returns the stub's publish handle.
 */
function provideSettings(ctx: Context, user: Record<string, unknown>): { publish: (next: Record<string, unknown>) => void } {
  const state = { user }
  ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'settings', {
    describe: () => [{ ns: 'evolution-curator', user: state.user }],
    configure: () => () => {},
  })
  return { publish: (next) => { state.user = next } }
}

/** One usage record shaped like the sidecar the lifecycle engine reads. */
function usageRecord(idleDays: number, patchCount: number, viewCount: number): UsageRecord {
  const at = new Date(Date.now() - idleDays * 86_400_000).toISOString()
  return {
    created_by: 'agent', created_at: new Date(Date.now() - 300 * 86_400_000).toISOString(),
    use_count: 1, view_count: viewCount, patch_count: patchCount,
    last_used_at: at, last_viewed_at: viewCount > 0 ? at : null, last_patched_at: at,
    state: 'active', pinned: false, archived_at: null,
  }
}

/** A body over the 2k stamp floor with eight rc/date stamps (density between the
 * user bar of 1/KB and the row default of 2/KB) and no support files. */
function stampedBody(name: string): string {
  const lines = ['---', 'name: ' + name, 'description: ' + name + ' body.', '---', '', 'Body of ' + name + '.']
  for (let i = 0; i < 60; i += 1) {
    lines.push(`Filler line ${i} for ${name} keeps the body size above the stamp floor of the health view.`)
  }
  lines.push('Released rc.1 after the first pass.')
  lines.push('Merged 2024-01-01 with the second pass.')
  lines.push('Retired rc.2 once the third pass landed.')
  lines.push('Reviewed 2024-02-02 against the fourth pass.')
  lines.push('Cut rc.3 in the fifth pass.')
  lines.push('Reopened 2024-03-03 for the sixth pass.')
  lines.push('Shipped rc.4 with the seventh pass.')
  lines.push('Rechecked 2024-04-04 on the eighth pass.')
  return lines.join('\n') + '\n'
}

describe('curator parameter surface (G1: row config, precedence and the cross-field rule)', () => {
  it('refuses a pair whose archive window sits below the stale window', () => {
    expect(() => { validateCuratorSettings({ staleAfterDays: 30, archiveAfterDays: 10 }) })
      .toThrow(/archiveAfterDays \(10\) must be >= staleAfterDays \(30\)/)
    // Equal windows are legitimate (archive exactly when it turns stale).
    expect(() => { validateCuratorSettings({ staleAfterDays: 10, archiveAfterDays: 10 }) }).not.toThrow()
  })

  it('reports an impossible pair and never archives on it', async () => {
    await tempHome('dsh-curator-settings-pair-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    // archive(1) < stale(30) as supplied: the deployment is told, and the engine keeps
    // the stale threshold as the archive threshold (resolved at USE time by lifecycle()).
    const curator = new EvolutionCurator(ctx, { enabled: true, autoStart: false, staleAfterDays: vol(30), archiveAfterDays: vol(1) })
    expect(warnSpy.mock.calls.some(call => String(call[0]).includes('using staleAfterDays as the archive threshold')), 'the impossible pair is reported').toBe(true)
    const skills = curator.skills
    await skills.create('aging-skill', '---\nname: aging-skill\ndescription: Aging body.\n---\n\nAging body.\n', 'foreground')
    // 5 idle days: the supplied archive window (1 day) would archive it, the lifted one
    // (30 = the stale window) leaves it alone — the engine never archives a skill the
    // stale window has not even reached yet.
    await saveUsage(skills.root, new Map([['aging-skill', usageRecord(5, 0, 2)]]), nodeEvolutionIo())
    const pass = await curator.run({ ignoreGates: true })
    expect([...pass.stale, ...pass.archived], 'the lifted archive window leaves the skill alone').not.toContain('aging-skill')
    warnSpy.mockRestore()
    curator.stop()
  }, 30_000)

  it('applies a live row value to the next run without a restart', async () => {
    await tempHome('dsh-curator-settings-live-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const llmReview = mutableVol(true)
    const curator = new EvolutionCurator(ctx, { enabled: true, autoStart: false, llmReview: llmReview.ref })
    const first = await curator.run({ ignoreGates: true })
    expect(first.report.llmReviewEnabled, 'the row value applies').toBe(true)
    // The loader writes a new value into the same reference: no restart, no watcher.
    llmReview.set(false)
    const second = await curator.run({ ignoreGates: true })
    expect(second.report.llmReviewEnabled, 'the moved value applies to the next run').toBe(false)
    curator.stop()
  })

  it('moves the lifecycle window when the row windows change', async () => {
    await tempHome('dsh-curator-settings-window-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const stale = mutableVol(30)
    const archive = mutableVol(90)
    const curator = new EvolutionCurator(ctx, { enabled: true, autoStart: false, staleAfterDays: stale.ref, archiveAfterDays: archive.ref })
    const skills = curator.skills
    await skills.create('aging-skill', '---\nname: aging-skill\ndescription: Aging body.\n---\n\nAging body.\n', 'foreground')
    await saveUsage(skills.root, new Map([['aging-skill', usageRecord(5, 0, 2)]]), nodeEvolutionIo())
    const underRow = await curator.run({ ignoreGates: true })
    expect([...underRow.stale, ...underRow.archived], 'the 30/90 window leaves a 5-day-idle skill alone').not.toContain('aging-skill')
    stale.set(1)
    archive.set(2)
    const underShort = await curator.run({ ignoreGates: true })
    expect([...underShort.stale, ...underShort.archived]).toContain('aging-skill')
    expect(['stale', 'archived']).toContain((await loadUsage(skills.root, nodeEvolutionIo())).get('aging-skill')?.state)
    curator.stop()
  }, 30_000)

  it('closes the idle gate when the row says the probe must fail closed', async () => {
    await tempHome('dsh-curator-settings-idle-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    ctx.provide('evolutionState', {
      loadCuratorState: async () => ({ lastRunAt: Date.now() - 30 * 86_400_000, runCount: 1, lastSummary: 'seed', paused: false }),
      saveCuratorState: async () => {},
      transactCuratorState: async () => {},
    })
    const failClosed = mutableVol(true)
    // No `agents` service at all: fail-open lets the pass through, fail-closed defers it.
    const curator = new EvolutionCurator(ctx, {
      enabled: true, autoStart: false, intervalHours: 24, minIdleHours: vol(2), minIdleFailOpen: failClosed.ref,
    })
    expect((await curator.run()).skipped).toBeUndefined()
    failClosed.set(false)
    expect((await curator.run()).skipped, 'fail-closed defers on an unmeasurable session').toBe('active-session')
    curator.stop()
  })

  it('hands the row LLM budget to the provider call and honours its timeout', async () => {
    await tempHome('dsh-curator-settings-budget-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const captured: Array<{ maxTokens?: number | undefined }> = []
    ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'llm', {
      // A provider that only settles when the curator's own signal aborts: the pass
      // can end ONLY through the timeout under test.
      stream: async function* (options: { maxTokens?: number; signal?: AbortSignal }) {
        captured.push(options)
        await new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => { reject(new Error('aborted by the curator timeout')) })
        })
      },
    })
    const curator = new EvolutionCurator(ctx, {
      enabled: true, autoStart: false,
      curatorReviewMaxTokens: vol(11), curatorReviewTimeoutMs: vol(5),
    })
    const started = Date.now()
    const nominations = await curator.recommend(['aging-skill'])
    expect(captured[0]?.maxTokens, 'the row token budget reaches the provider').toBe(11)
    expect(Date.now() - started, 'the 5ms row timeout ended the pass').toBeLessThan(5_000)
    expect(nominations.prunings).toEqual([])
    curator.stop()
  }, 20_000)

  it('tightens the health view with the row thresholds', async () => {
    await tempHome('dsh-curator-settings-health-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const softBody = mutableVol(20_000)
    const stampDensity = mutableVol(2)
    const churn = mutableVol(20)
    const curator = new EvolutionCurator(ctx, {
      enabled: true, autoStart: false,
      healthSoftBodyChars: softBody.ref, healthStampDensityPerKb: stampDensity.ref, healthChurnMinPatches: churn.ref,
    })
    const skills = curator.skills
    await skills.create('ghost-skill', stampedBody('ghost-skill'), 'foreground')
    await skills.create('viewed-skill', '---\nname: viewed-skill\ndescription: Viewed body.\n---\n\nViewed body.\n', 'foreground')
    await saveUsage(skills.root, new Map([
      ['ghost-skill', usageRecord(1, 2, 0)],
      ['viewed-skill', usageRecord(1, 0, 3)],
    ]), nodeEvolutionIo())
    expect(await curator.healthView(), 'the row defaults judge this tree healthy').toEqual([])
    softBody.set(1); stampDensity.set(1); churn.set(1)
    const degraded = await curator.healthView()
    const ghost = degraded.find(row => row.name === 'ghost-skill')
    expect(ghost, 'the moved thresholds flag the body').toBeDefined()
    expect(ghost?.reasons.join(' | ')).toMatch(/soft line/)
    expect(ghost?.reasons.join(' | ')).toMatch(/stamp density/)
    expect(ghost?.reasons.join(' | ')).toMatch(/write-ghost/)
    curator.stop()
  }, 30_000)

  it('a key the user set beats the deployment policy (G1 §8.4-A)', async () => {
    await tempHome('dsh-curator-settings-precedence-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const settings = provideSettings(ctx, { staleAfterDays: 30 })
    ctx.provide('evolutionPolicy', { get: () => ({ staleAfterDays: 1, archiveAfterDays: 2 }) })
    const curator = new EvolutionCurator(ctx, {
      enabled: true, autoStart: false,
      staleAfterDays: vol(30), archiveAfterDays: vol(90),
    })
    const skills = curator.skills
    await skills.create('aging-skill', '---\nname: aging-skill\ndescription: Aging body.\n---\n\nAging body.\n', 'foreground')
    await saveUsage(skills.root, new Map([['aging-skill', usageRecord(5, 0, 2)]]), nodeEvolutionIo())
    // The user set staleAfterDays: the policy's 1-day window must NOT win.
    const underUser = await curator.run({ ignoreGates: true })
    expect([...underUser.stale, ...underUser.archived], 'the user key outranks the policy').not.toContain('aging-skill')
    // The user clears it: the policy's window applies from the next run on.
    settings.publish({})
    const underPolicy = await curator.run({ ignoreGates: true })
    expect([...underPolicy.stale, ...underPolicy.archived], 'without a user key the policy applies').toContain('aging-skill')
    curator.stop()
  }, 30_000)
})
