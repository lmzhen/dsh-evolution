import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '../src/index.ts'
import { eventsFile, loadUsage, nodeEvolutionIo, readEvolutionTimeline, saveUsage, skillsRoot } from '@deepseek-ai/dsh-evolution-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('skill-usage', () => {
  it('records use and persists to disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    expect((await ctx.skillUsage.report()).get('demo')?.use_count).toBe(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('P1-4: the sidecar key is trimmed at the service boundary (ghost-key divergence, 0.3.58)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-trim-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('  spaced-name  ', 'use')
    await ctx.skillUsage.ensureRecordCreated(' spaced-create ', false)
    const map = await ctx.skillUsage.report()
    expect(map.has('spaced-name')).toBe(true)
    expect(map.has('  spaced-name  ')).toBe(false)
    expect(map.has('spaced-create')).toBe(true)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V6-43: the telemetry listener is registered through an effect (HMR disposal ownership, 0.3.37)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-dispose-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const fiber = await ctx.plugin(SkillUsageRegistry, { root })
    // The platform HMR-safety contract: registrations belong to effects, so
    // dispose removes them — a bare ctx.on in the constructor is an
    // unowned observer (the tool-memory/skill-catalog pattern).
    expect(fiber.getEffects().some(effect => effect.label === 'skill-usage.telemetry')).toBe(true)
    // Pre-dispose behavior: a session event read bumps the view counter.
    const usage = ctx.skillUsage
    await usage.record('demo', 'use')
    ctx.emit('session/event', { id: 's1' } as never, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":"demo"}' } } as never)
    let settled = 0
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      settled = (await usage.report()).get('demo')?.view_count ?? 0
      if (settled > 0) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(settled).toBeGreaterThan(0)
    await fiber.dispose()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('markArchived sets state without bumping the patch counter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-archive-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'patch')
    await ctx.skillUsage.markArchived('demo')
    const record = (await ctx.skillUsage.report()).get('demo')
    expect(record?.state).toBe('archived')
    expect(record?.archived_at).toBeTruthy()
    expect(record?.patch_count).toBe(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('invalidate() re-reads external writes instead of re-covering them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-invalidate-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    // The curator writes the sidecar directly (simulated here as an external
    // quality/state update), then invalidates the registry cache.
    const usage = await loadUsage(root, nodeEvolutionIo())
    const record = usage.get('demo')
    if (record) record.quality_score = 0.9
    await saveUsage(root, usage, nodeEvolutionIo())
    await ctx.skillUsage.invalidate()
    // A subsequent telemetry write must not re-cover the external quality change.
    await ctx.skillUsage.record('demo', 'view')
    const seen = (await ctx.skillUsage.report()).get('demo')
    expect(seen?.quality_score).toBe(0.9)
    expect(seen?.view_count).toBe(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('falls back to skillsRoot() when root is unset or empty (P0-3)', async () => {
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    // No `{ root }`: schemastery's default('') must not win over the real path.
    await ctx.plugin(SkillUsageRegistry)
    expect(ctx.skillUsage.root).toBe(skillsRoot())
  })

  it('observes the skill tool read through session/event and records a view (A2)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-observe-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root, eventsHome: root })
    await ctx.skillUsage.ensureRecordCreated('demo-read', false)
    const toolCall = (name: string, args: unknown) => ({
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c1', name, arguments: JSON.stringify(args) },
    }) as never
    ctx.emit('session/event', {} as never, toolCall('skill', { name: 'demo-read' }))
    // The catalog has no skill_load/skill_search discovery pair (0.3.18 E-59e),
    // so only the real `skill` tool is a read — phantom tools must not count.
    ctx.emit('session/event', {} as never, toolCall('skill_load', { skill: 'demo-read' }))
    ctx.emit('session/event', {} as never, toolCall('skill_search', { name: 'demo-read' }))
    await ctx.skillUsage.invalidate()
    const seen = (await ctx.skillUsage.report()).get('demo-read')
    expect(seen?.view_count).toBe(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('appends the observation-window anchor once, on the first observed read (C)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-anchor-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root, eventsHome: root })
    await ctx.skillUsage.ensureRecordCreated('anchor-skill', false)
    const read = (step: number) => {
      ctx.emit('session/event', {} as never, {
        type: 'tool/call',
        data: { turn: 1, step, callId: `c${step}`, name: 'skill', arguments: JSON.stringify({ name: 'anchor-skill' }) },
      } as never)
    }
    read(1)
    read(2)
    await ctx.skillUsage.invalidate()
    const { events } = await readEvolutionTimeline(nodeEvolutionIo(), eventsFile(root))
    const anchors = events.filter(event => event.type === 'usage')
    expect(anchors).toHaveLength(1)
    expect(anchors[0]?.kind).toBe('skill')
    expect(anchors[0]?.source).toBe('observation')
    expect(anchors[0]?.window?.opened).toBeTruthy()
    // Counts are the snapshot at the moment the window opened (first read).
    expect(anchors[0]?.counts?.views).toBe(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('does not mint a usage record for a read of an unknown skill (A2 guard)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-no-mint-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    ctx.emit('session/event', {} as never, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: JSON.stringify({ name: 'never-created' }) },
    } as never)
    await ctx.skillUsage.invalidate()
    expect((await ctx.skillUsage.report()).has('never-created')).toBe(false)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('skips malformed tool/call events without throwing and without counting (E-65)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-malformed-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.ensureRecordCreated('malformed-demo', false)
    // `data` absent entirely — an external emitter can inject a broken event.
    ctx.emit('session/event', {} as never, { type: 'tool/call' } as never)
    // `data` present but carries no `name`.
    ctx.emit('session/event', {} as never, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c1', arguments: JSON.stringify({ name: 'malformed-demo' }) },
    } as never)
    // `name` is present but not a string.
    ctx.emit('session/event', {} as never, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c2', name: 42, arguments: JSON.stringify({ name: 'malformed-demo' }) },
    } as never)
    await ctx.skillUsage.invalidate()
    const seen = (await ctx.skillUsage.report()).get('malformed-demo')
    expect(seen?.view_count).toBe(0)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('F-203: JSON-null arguments do not throw and do not count as a read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-null-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.ensureRecordCreated('null-args-demo', false)
    // `arguments` is the literal JSON value `null`: JSON.parse succeeds and
    // yields null, which must not throw on `.name` access nor mint a view.
    ctx.emit('session/event', {} as never, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: 'null' },
    } as never)
    await ctx.skillUsage.invalidate()
    const seen = (await ctx.skillUsage.report()).get('null-args-demo')
    expect(seen?.view_count).toBe(0)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('E-70: ensureRecordCreated creates and marks authorship in one atomic write (0.3.18)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-e70-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.ensureRecordCreated('agent-skill', true)
    await ctx.skillUsage.ensureRecordCreated('user-skill', false)
    const report = await ctx.skillUsage.report()
    expect(report.get('agent-skill')?.created_by).toBe('agent')
    expect(report.get('agent-skill')?.patch_count).toBe(0)
    expect(report.get('user-skill')).toBeDefined()
    expect(report.get('user-skill')?.created_by).toBeNull()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('N5 (v12): setQuality trims like the authoring entries (no silent quality drop)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-n5q-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    await ctx.skillUsage.setQuality('  demo  ', 0.42, true)
    const record = (await ctx.skillUsage.report()).get('demo')
    expect(record?.quality_score).toBe(0.42)
    expect(record?.quality_warn).toBe(true)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('N5 (v12): observeRead counts a whitespace-y tool name against the trimmed key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-n5v-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    // skillNameFromToolCall mirrors the raw arguments `name` (no trim) — the
    // read must land on the trimmed sidecar key.
    ctx.emit('session/event', { id: 's1' } as never, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":" demo "}' } } as never)
    const deadline = Date.now() + 3000
    let views = 0
    while (Date.now() < deadline) {
      views = (await ctx.skillUsage.report()).get('demo')?.view_count ?? 0
      if (views > 0) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(views).toBe(1)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
