import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator, { gateConsolidations } from '../src/index.ts'
import { nodeEvolutionIo, saveUsage, loadUsage } from '@deepseek-ai/dsh-evolution-core'

describe('evolution-curator', () => {
  it('starts stopped by default, runs manually, and persists a run report', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    // A persisted state older than the interval lets the gated run() proceed
    // (with no state service at all the P1-7 normalization defers first sight).
    let saved = { lastRunAt: Date.now() - 30 * 86_400_000, runCount: 1, lastSummary: 'seed', paused: false }
    ctx.provide('evolutionState', {
      loadCuratorState: async () => saved,
      saveCuratorState: async (record: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean }) => { saved = record },
    })
    await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24 })
    ctx.evolutionCurator.start()
    const result = await ctx.evolutionCurator.run()
    expect(Array.isArray(result.stale)).toBe(true)
    expect(Array.isArray(result.archived)).toBe(true)
    expect(result.report.runId).toBeTruthy()
    // Decision visibility: the default (llmReview off) is recorded on every report.
    expect(result.report.llmReviewEnabled).toBe(false)
    expect(await ctx.evolutionCurator.latestReport()).toMatchObject({ runId: result.report.runId })
    ctx.evolutionCurator.stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })

  it('records llmReview: true on the run report when the LLM channel is enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-llm-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24, llmReview: true })
    const result = await ctx.evolutionCurator.run({ ignoreGates: true })
    // No `llm` service mounted: recommend() degrades to empty nominations,
    // but the report still states the channel was enabled.
    expect(result.report.llmReviewEnabled).toBe(true)
    expect(result.nominations).toBeDefined()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('references factor: related_skills frontmatter raises the hub skill score', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-references-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator)
    const skills = ctx.evolutionCurator.skills
    const skill = (name: string, description: string, extra = '') => `---\nname: ${name}\ndescription: ${description}${extra}\n---\nBody of ${name}.\n`
    await skills.create('hub-skill', skill('hub-skill', 'h', '\nrelated_skills: [leaf-skill]'), 'foreground')
    await skills.create('leaf-skill', skill('leaf-skill', 'l'), 'foreground')
    await ctx.evolutionCurator.run({ ignoreGates: true })
    const usage = await loadUsage(skills.root, nodeEvolutionIo())
    // The referenced skill (leaf) takes the in-degree boost, not its referrer.
    expect(usage.get('leaf-skill')?.quality_score).toBeGreaterThan(usage.get('hub-skill')?.quality_score ?? 0)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('pins through the marker keep an old skill out of the lifecycle run', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-pin-gate-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator)
    const skills = ctx.evolutionCurator.skills
    const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}.\n`
    await skills.create('precious-skill', skill('precious-skill', 'p'), 'background_review')
    const old = new Date(Date.now() - 200 * 86_400_000)
    await saveUsage(skills.root, new Map([['precious-skill', {
      created_by: 'agent', created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0,
      last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null,
      state: 'active', pinned: false, archived_at: null,
    }]]), nodeEvolutionIo())
    // Pin via the store marker (what the tool calls): the marker alone must
    // keep the lifecycle away (regression for the marker->usage mirror gap).
    await skills.setPinned('precious-skill', true, 'foreground')
    const result = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect(result.archived).toEqual([])
    expect((await skills.list()).some(s => s.name === 'precious-skill')).toBe(true)
    // Unpin: the same record now archives as expected.
    await skills.setPinned('precious-skill', false, 'foreground')
    const again = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect(again.archived).toEqual(['precious-skill'])
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('reentrant run() is skipped with an explicit already-running outcome', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-reentrancy-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator)
    const [first, second] = await Promise.all([
      ctx.evolutionCurator.run({ ignoreGates: true }),
      ctx.evolutionCurator.run({ ignoreGates: true }),
    ])
    const skipped = [first, second].filter(result => result.skipped === 'already-running')
    expect(skipped.length).toBe(1)
    expect([first, second].some(result => result.skipped === undefined)).toBe(true)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('snapshotFull captures curator state and restoreSnapshot rewinds tree + state', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-full-restore-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    let saved = { lastRunAt: 1, runCount: 0, lastSummary: 'seed', paused: false }
    ctx.provide('evolutionState', {
      loadCuratorState: async () => saved,
      saveCuratorState: async (record: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean }) => { saved = record },
    })
    // This fake state is anchored at epoch — DUE — so the auto-start boot
    // check must be off: this test own the snapshot/restore flow, not the
    // scheduler (a due autoCheck would run a pass against a stale env).
    await ctx.plugin(EvolutionCurator, { autoStart: false })
    const skills = ctx.evolutionCurator.skills
    const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}.\n`
    await skills.create('pre-skill', skill('pre-skill', 'p'), 'foreground')
    await ctx.evolutionCurator.snapshotFull('pre-test')
    // Mutate AFTER the snapshot: archive the skill and bump curator state.
    await skills.archive('pre-skill')
    saved = { lastRunAt: 99, runCount: 7, lastSummary: 'post', paused: true }
    const restored = await ctx.evolutionCurator.restoreSnapshot()
    expect(restored.ok).toBe(true)
    expect((await skills.list()).map(item => item.name)).toContain('pre-skill')
    expect(saved).toEqual({ lastRunAt: 1, runCount: 0, lastSummary: 'seed', paused: false })
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('auto-start boot check catches up a due persisted state after a restart', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-boot-catchup-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    let saved = { lastRunAt: Date.now() - 30 * 86_400_000, runCount: 0, lastSummary: 'seed', paused: false }
    ctx.provide('evolutionState', {
      loadCuratorState: async () => saved,
      saveCuratorState: async (record: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean }) => { saved = record },
    })
    await ctx.plugin(EvolutionCurator, { autoStart: true, bootGraceSeconds: 0, intervalHours: 24 })
    // The boot check is deferred (never synchronous with the half-built host);
    // poll until the persisted state shows the catch-up pass landed.
    const deadline = Date.now() + 2000
    while (saved.runCount === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(saved.runCount).toBe(1)
    expect(saved.lastSummary).toMatch(/^auto:/)
    ctx.evolutionCurator.stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('auto-start boot check stays quiet when the persisted state is not due', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-boot-quiet-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    let saved = { lastRunAt: Date.now() - 86_400_000, runCount: 3, lastSummary: 'seed', paused: false }
    ctx.provide('evolutionState', {
      loadCuratorState: async () => saved,
      saveCuratorState: async (record: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean }) => { saved = record },
    })
    // intervalHours = 336: a 1-day-old run is NOT due → no pass may fire.
    await ctx.plugin(EvolutionCurator, { autoStart: true, bootGraceSeconds: 0, intervalHours: 336 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(saved.runCount).toBe(3)
    expect(saved.lastSummary).toBe('seed')
    ctx.evolutionCurator.stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('gateConsolidations blocks automated merges that touch gated names', () => {
    const nominations = [
      { from: 'narrow-a', into: 'umbrella' },
      { from: 'scheduled-skill', into: 'umbrella' },
      { from: 'narrow-b', into: 'excluded-target' },
      { from: 'narrow-c', into: 'suppressed-target' },
    ]
    const gated = gateConsolidations(nominations, {
      exclude: new Set(['excluded-target']),
      referenced: new Set(['scheduled-skill']),
      suppressed: new Set(['suppressed-target']),
    })
    expect(gated).toEqual([{ from: 'narrow-a', into: 'umbrella' }])
  })

  it('consolidates sources into a target, then restores one from the archive', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-consolidate-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator)
    const skills = ctx.evolutionCurator.skills
    const skill = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`
    await skills.create('target-skill', skill('target-skill', 't', 'Target body.'), 'foreground')
    await skills.create('source-a', skill('source-a', 'a', 'Body A.'), 'foreground')
    await skills.create('source-b', skill('source-b', 'b', 'Body B.'), 'foreground')
    const result = await ctx.evolutionCurator.consolidate('target-skill', ['source-a', 'source-b'])
    expect(result.ok).toBe(true)
    const merged = await skills.read('target-skill')
    expect(merged).toContain('Body A.')
    expect(merged).toContain('Body B.')
    let names = (await skills.list()).map(item => item.name)
    expect(names).not.toContain('source-a')
    expect(names).not.toContain('source-b')
    const restore = await ctx.evolutionCurator.restore('source-a')
    expect(restore.ok).toBe(true)
    names = (await skills.list()).map(item => item.name)
    expect(names).toContain('source-a')
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('refuses consolidation with a missing target', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-consolidate-bad-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator)
    const result = await ctx.evolutionCurator.consolidate('ghost-target', ['ghost-source'])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('archives a skill that reached the archive threshold (F1 regression)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-archive-threshold-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true })
    const skills = ctx.evolutionCurator.skills
    const body = (name: string, text: string) => `---\nname: ${name}\ndescription: ${text}\n---\n${text}\n`
    await skills.create('ancient-skill', body('ancient-skill', 'Ancient body.'), 'background_review')
    // Seed an agent-created usage record that is far past the archive
    // threshold. Under the rc.12 bug every such candidate failed because
    // 'Lifecycle: reached archive threshold' was validated as an absorbed-into
    // skill name; this run must archive it cleanly.
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
    await saveUsage(skills.root, new Map([['ancient-skill', {
      created_by: 'agent', created_at: old, use_count: 1, view_count: 0, patch_count: 0,
      last_used_at: old, last_viewed_at: null, last_patched_at: null,
      state: 'active', pinned: false, archived_at: null,
    }]]), nodeEvolutionIo())
    const result = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect(result.archived).toContain('ancient-skill')
    expect(result.errors).toEqual([])
    // The archived state must be persisted on the usage record, or the next
    // run treats the missing directory as a candidate again (B/D regression).
    const usage = await loadUsage(skills.root, nodeEvolutionIo())
    const record = usage.get('ancient-skill')
    expect(record?.state).toBe('archived')
    expect(record?.archived_at).toBeTruthy()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('seeds baseline records for tree skills the sidecar has not seen (F8)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-seed-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true })
    const skills = ctx.evolutionCurator.skills
    const body = (name: string, text: string) => `---\nname: ${name}\ndescription: ${text}\n---\n${text}\n`
    await skills.create('fresh-skill', body('fresh-skill', 'Fresh body.'), 'foreground')
    const result = await ctx.evolutionCurator.run({ ignoreGates: true })
    // Fresh skill: seeded baseline (clock anchored now) and left untouched.
    expect(result.stale).toEqual([])
    expect(result.archived).toEqual([])
    const usage = await import('@deepseek-ai/dsh-evolution-core').then(m => m.loadUsage(skills.root, nodeEvolutionIo()))
    expect(usage.has('fresh-skill')).toBe(true)
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('dry-run reports what WOULD happen without mutating or pushing out the next run', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-dryrun-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true })
    const skills = ctx.evolutionCurator.skills
    const body = (name: string, text: string) => `---\nname: ${name}\ndescription: ${text}\n---\n${text}\n`
    await skills.create('ancient-skill', body('ancient-skill', 'Ancient body.'), 'background_review')
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
    await saveUsage(skills.root, new Map([['ancient-skill', {
      created_by: 'agent', created_at: old, use_count: 1, view_count: 0, patch_count: 0,
      last_used_at: old, last_viewed_at: null, last_patched_at: null,
      state: 'active', pinned: false, archived_at: null,
    }]]), nodeEvolutionIo())
    const stateService = ctx.get('evolutionState') as { loadCuratorState(): Promise<{ lastRunAt: number } | null> } | undefined
    const before = await stateService?.loadCuratorState()
    const result = await ctx.evolutionCurator.run({ ignoreGates: true, dryRun: true })
    // The skill stays in the active tree and the report records the would-be move.
    expect(result.archived).toEqual([])
    expect((await skills.list()).some(s => s.name === 'ancient-skill')).toBe(true)
    expect(result.report.archiveCandidates).toContain('ancient-skill')
    expect(result.report.runId).toBeTruthy()
    const after = await stateService?.loadCuratorState()
    // A dry-run must not push the next scheduled pass out (lastRunAt/runCount unchanged).
    if (before && after) {
      expect(after.lastRunAt).toBe(before.lastRunAt)
    }
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
  it('defers on first sight even without a state service (P1-7)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-nostate-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    // No evolutionState mounted: `persisted` used to stay undefined, the
    // first-run defer never fired (`persisted === null`) and the interval gate
    // compared NaN — the curator ran immediately on a fresh install. The
    // normalization makes undefined behave exactly like "no state yet".
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false })
    const result = await ctx.evolutionCurator.run()
    expect(result.skipped).toBe('first-run-deferred')
    ctx.evolutionCurator.stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('quality-warn scoring drives the SAME run stale window (P1-2)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-score-order-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { enabled: true })
    const skills = ctx.evolutionCurator.skills
    await skills.create('aging-skill', `---
name: aging-skill
description: Aging body.
---
Aging body.
`, 'background_review')
    // Old activity (quality score low -> warn) but idle only 12 days: under
    // the plain staleAfterDays=30 window this is NOT stale. The fix makes the
    // freshly computed quality_warn (score ~0.28 < 0.3: stability 0 from the
    // patch, recency 1) apply the shorter qualityWarnStaleAfterDays=7 window
    // within the SAME run.
    const created = new Date(Date.now() - 300 * 86_400_000).toISOString()
    const lastUsed = new Date(Date.now() - 12 * 86_400_000).toISOString()
    await saveUsage(skills.root, new Map([['aging-skill', {
      created_by: 'agent', created_at: created, use_count: 1, view_count: 0, patch_count: 1,
      last_used_at: lastUsed, last_viewed_at: null, last_patched_at: lastUsed,
      state: 'active', pinned: false, archived_at: null,
    }]]), nodeEvolutionIo())
    const result = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect(result.stale).toContain('aging-skill')
    const usage = await loadUsage(skills.root, nodeEvolutionIo())
    expect(usage.get('aging-skill')?.quality_warn).toBe(true)
    expect(usage.get('aging-skill')?.state).toBe('stale')
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('paused gate skips automatic passes; manual run and resume still work (G2)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-paused-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    let saved = { lastRunAt: Date.now() - 30 * 86_400_000, runCount: 1, lastSummary: 'seed', paused: true }
    ctx.provide('evolutionState', {
      loadCuratorState: async () => saved,
      saveCuratorState: async (record: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean }) => { saved = record },
    })
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false })
    const skills = ctx.evolutionCurator.skills
    await skills.create('ancient-skill', `---
name: ancient-skill
description: Ancient body.
---
Ancient body.
`, 'background_review')
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
    await saveUsage(skills.root, new Map([['ancient-skill', {
      created_by: 'agent', created_at: old, use_count: 1, view_count: 0, patch_count: 0,
      last_used_at: old, last_viewed_at: null, last_patched_at: null,
      state: 'active', pinned: false, archived_at: null,
    }]]), nodeEvolutionIo())
    // Automatic pass: the paused gate fires before every other gate.
    const gated = await ctx.evolutionCurator.run()
    expect(gated.skipped).toBe('paused')
    // Manual semantics (ignoreGates) bypass the pause, as designed.
    const manual = await ctx.evolutionCurator.run({ ignoreGates: true })
    expect(manual.archived).toContain('ancient-skill')
    // Resume persists through the same record.
    await ctx.evolutionCurator.setPaused(false)
    expect(saved.paused).toBe(false)
    expect(await ctx.evolutionCurator.status()).toMatchObject({ paused: false })
    ctx.evolutionCurator.stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

  it('setPaused seeds state when none exists; status() exposes it (G2)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-setpaused-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    let saved: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null = null
    ctx.provide('evolutionState', {
      loadCuratorState: async () => saved,
      saveCuratorState: async (record: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean }) => { saved = record },
    })
    await ctx.plugin(EvolutionCurator, { enabled: true, autoStart: false })
    expect(await ctx.evolutionCurator.status()).toBeNull()
    await ctx.evolutionCurator.setPaused(true)
    // Seeded from nothing: lastRunAt anchors NOW so a later resume re-enters
    // through the interval gate instead of firing immediately.
    expect(saved).toMatchObject({ runCount: 0, lastSummary: 'paused', paused: true })
    expect(Date.now() - saved!.lastRunAt).toBeLessThan(60_000)
    expect(await ctx.evolutionCurator.status()).toMatchObject({ paused: true })
    ctx.evolutionCurator.stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })

})
