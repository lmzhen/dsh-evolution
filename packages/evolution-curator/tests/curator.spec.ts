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
})
