import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator, { CURATOR_SETTINGS_SCHEMA, validateCuratorSettings, type CuratorSettings } from '../src/index.ts'
import { loadUsage, nodeEvolutionIo, saveUsage } from '@deepseek-ai/dsh-evolution-core'
import type { UsageRecord } from '@deepseek-ai/dsh-evolution-core'
import { tempHome } from '../../test-support/temp-home.ts'

// v21 (T-8): restore the real DSH_HOME after EVERY test, success or failure —
// one failing assertion must not leak a temp home into the rest of the worker.
const REAL_DSH_HOME = process.env.DSH_HOME
afterEach(() => {
  if (REAL_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = REAL_DSH_HOME
})

/** The section's schema defaults, as the platform would resolve them. */
function sectionValues(): CuratorSettings {
  return {
    curatorIntervalHours: 24,
    staleAfterDays: 30,
    archiveAfterDays: 90,
    qualityWarnStaleAfterDays: 7,
    minIdleHours: 2,
    minIdleFailOpen: true,
    llmReview: false,
    curatorReviewMaxTokens: 2048,
    curatorReviewTimeoutMs: 120_000,
    healthSoftBodyChars: 20_000,
    healthStampDensityPerKb: 2,
    healthChurnMinPatches: 20,
  }
}

/** What the fake provider recorded, and the live document it serves. */
interface FakeSettings {
  registrations: Array<{ validate?: ((value: unknown) => void) | undefined }>
  user: Record<string, unknown>
  /** Commit a new user section and notify the owner, as settings-file does. */
  publish: (next: Record<string, unknown>) => void
}

/**
 * Minimal settings provider stub. The family reads the user layer through
 * `describe()`, and the registration options are captured so a sentry can prove
 * the cross-field hook rides the platform registration rather than living unused.
 * `publish` is the commit notification the core refreshes its cached raw section
 * from, so a test can change the document the way the file provider does.
 */
function provideSettings(ctx: Context, user: Record<string, unknown>): FakeSettings {
  const watchers: Array<() => void> = []
  const state: FakeSettings = {
    registrations: [],
    user,
    publish: (next) => {
      state.user = next
      for (const callback of watchers) callback()
    },
  }
  ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'settings', {
    register: (_ns: string, _schema: unknown, options: { base: unknown; validate?: (value: unknown) => void }) => {
      state.registrations.push(options.validate === undefined ? {} : { validate: options.validate })
      return {
        get: () => ({ ...(options.base as Record<string, unknown>), ...state.user }),
        watch: (callback: () => void) => { watchers.push(callback); return () => {} },
      }
    },
    describe: () => [{ ns: 'evolution-curator', user: state.user }],
  })
  return state
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

describe('curator parameter section (G3/S3.3)', () => {
  it('refuses a resolved pair whose archive window sits below the stale window', () => {
    const values = sectionValues()
    expect(() => { validateCuratorSettings({ ...values, staleAfterDays: 30, archiveAfterDays: 10 }) })
      .toThrow(/archiveAfterDays \(10\) must be >= staleAfterDays \(30\)/)
    // Equal windows are legitimate (archive exactly when it turns stale).
    expect(() => { validateCuratorSettings({ ...values, staleAfterDays: 10, archiveAfterDays: 10 }) }).not.toThrow()
    // The hook is the schema's companion, not a replacement: both are required.
    expect(CURATOR_SETTINGS_SCHEMA).toBeDefined()
  })

  it('registers the cross-field hook with the platform', async () => {
    await tempHome('dsh-curator-settings-hook-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const settings = provideSettings(ctx, {})
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false })
    expect(settings.registrations).toHaveLength(1)
    const validate = settings.registrations[0]?.validate
    expect(typeof validate).toBe('function')
    // The platform hands the hook the RESOLVED section: a user patch that leaves
    // the effective archive window below the stale window is refused at the write.
    expect(() => { validate?.({ ...sectionValues(), staleAfterDays: 31, archiveAfterDays: 29 }) })
      .toThrow(/archiveAfterDays \(29\) must be >= staleAfterDays \(31\)/)
  })

  it('applies a user-layer value to the next run without a restart', async () => {
    await tempHome('dsh-curator-settings-live-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const settings = provideSettings(ctx, { llmReview: true })
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false, llmReview: false })
    const first = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect(first.report.llmReviewEnabled, 'the user layer beats the row').toBe(true)
    // The user clears it again: the NEXT run reads the new document, no restart.
    settings.publish({})
    const second = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect(second.report.llmReviewEnabled, 'an unset key falls back to the row').toBe(false)
  })

  it('moves the lifecycle window when the user sets the stale and archive windows', async () => {
    await tempHome('dsh-curator-settings-window-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const settings = provideSettings(ctx, {})
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false, staleAfterDays: 30, archiveAfterDays: 90 })
    const skills = ctx.evolutionCurator.skills
    await skills.create('aging-skill', '---\nname: aging-skill\ndescription: Aging body.\n---\n\nAging body.\n', 'foreground')
    await saveUsage(skills.root, new Map([['aging-skill', usageRecord(5, 0, 2)]]), nodeEvolutionIo())
    const underRow = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect([...underRow.stale, ...underRow.archived], 'the row window leaves a 5-day-idle skill alone').not.toContain('aging-skill')
    // Same tree, same usage, only the user document changed: the shorter pair
    // (archive 2 <= idle 5, stale 1) makes this very run act on the skill.
    settings.publish({ staleAfterDays: 1, archiveAfterDays: 2, qualityWarnStaleAfterDays: 1 })
    const underUser = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect([...underUser.stale, ...underUser.archived]).toContain('aging-skill')
    const state = (await loadUsage(skills.root, nodeEvolutionIo())).get('aging-skill')?.state
    expect(['stale', 'archived']).toContain(state)
  }, 30_000)

  it('closes the idle gate when the user says the probe must fail closed', async () => {
    await tempHome('dsh-curator-settings-idle-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    ctx.provide('evolutionState', {
      loadCuratorState: async () => ({ lastRunAt: Date.now() - 30 * 86_400_000, runCount: 1, lastSummary: 'seed', paused: false }),
      saveCuratorState: async () => {},
      transactCuratorState: async () => {},
    })
    const settings = provideSettings(ctx, {})
    // No `agents` service at all: the row's fail-open default lets the pass run.
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false, intervalHours: 24, minIdleHours: 2 })
    const open = await ctx.evolutionCurator.run()
    expect(open.skipped).toBeUndefined()
    settings.publish({ minIdleFailOpen: false })
    const closed = await ctx.evolutionCurator.run()
    expect(closed.skipped, 'the user layer fails the gate closed').toBe('active-session')
  })

  it('hands the user LLM budget to the provider call and honours its timeout', async () => {
    await tempHome('dsh-curator-settings-budget-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const captured: Array<{ maxTokens?: number | undefined }> = []
    ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'llm', {
      // A provider that only settles when the curator's own signal aborts: the
      // pass can end ONLY through the timeout under test.
      stream: async function* (options: { maxTokens?: number; signal?: AbortSignal }) {
        captured.push(options)
        await new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => { reject(new Error('aborted by the curator timeout')) })
        })
      },
    })
    provideSettings(ctx, { curatorReviewMaxTokens: 11, curatorReviewTimeoutMs: 5 })
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false, curatorReviewMaxTokens: 999, curatorReviewTimeoutMs: 120_000 })
    const started = Date.now()
    const nominations = await ctx.evolutionCurator.recommend(['aging-skill'])
    expect(captured[0]?.maxTokens, 'the user token budget reaches the provider').toBe(11)
    expect(Date.now() - started, 'the user timeout (5ms) ended the pass, not the row 120s').toBeLessThan(5_000)
    expect(nominations.prunings).toEqual([])
  }, 20_000)

  it('tightens the health view with the user thresholds', async () => {
    await tempHome('dsh-curator-settings-health-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const settings = provideSettings(ctx, {})
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false })
    const skills = ctx.evolutionCurator.skills
    await skills.create('ghost-skill', stampedBody('ghost-skill'), 'foreground')
    await skills.create('viewed-skill', '---\nname: viewed-skill\ndescription: Viewed body.\n---\n\nViewed body.\n', 'foreground')
    await saveUsage(skills.root, new Map([
      ['ghost-skill', usageRecord(1, 2, 0)],
      ['viewed-skill', usageRecord(1, 0, 3)],
    ]), nodeEvolutionIo())
    // Row defaults (20k chars / 2 per KB / 20 patches) judge this tree healthy.
    expect(await ctx.evolutionCurator.healthView()).toEqual([])
    settings.publish({ healthSoftBodyChars: 1, healthStampDensityPerKb: 1, healthChurnMinPatches: 1 })
    const degraded = await ctx.evolutionCurator.healthView()
    const ghost = degraded.find(row => row.name === 'ghost-skill')
    expect(ghost, 'the user lines flag the body').toBeDefined()
    expect(ghost?.reasons.join(' | ')).toMatch(/soft line/)
    expect(ghost?.reasons.join(' | ')).toMatch(/stamp density/)
    expect(ghost?.reasons.join(' | ')).toMatch(/write-ghost/)
  }, 30_000)
})
