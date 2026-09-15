import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
// `dsh-evolution-io-node` is a FUNCTION plugin (named `name`/`inject`/`apply`,
// no default export), so it is mounted as a namespace; the two service packages
// default-export their class.
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '../src/index.ts'
import { eventsFile, loadUsage, nodeEvolutionIo, readEvolutionTimeline, saveUsage, skillsRoot } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

/** S2-P2-12: a settled `tool/result` frame — view counting moved to SETTLE, so
 * a synthetic call must be paired with its outcome to count a view. */
const toolResult = (callId: string) => ({
  type: 'tool/result',
  data: { message: { source: { callId }, content: [{ type: 'tool-result', toolCallId: callId, isError: false }] } },
}) as never

describe('skill-usage', () => {
  it('records use and persists to disk', async () => {
    const root = await tempRoot('dsh-usage-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    expect((await ctx.skillUsage.report()).get('demo')?.use_count).toBe(1)
  })

  it('P1-4: the sidecar key is trimmed at the service boundary (ghost-key divergence, 0.3.58)', async () => {
    const root = await tempRoot('dsh-usage-trim-')
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
  })

  it('V6-43: the telemetry listener is registered through an effect (HMR disposal ownership, 0.3.37)', async () => {
    const root = await tempRoot('dsh-usage-dispose-')
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
    ctx.emit('session/event', { id: 's1' } as never, toolResult('c1'))
    let settled = 0
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      settled = (await usage.report()).get('demo')?.view_count ?? 0
      if (settled > 0) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(settled).toBeGreaterThan(0)
    await fiber.dispose()
  })

  it('C axis (v41): sessionScoped telemetry observes only the sessions that carry the family tools', async () => {
    // 0.3.77 (C axis): a session that does not carry the family's model rows
    // is not observed. Inside a variant preset that is every session running
    // the platform's original presets — before this gate their reads were still
    // counted (the family observing a session that never mounted it). A
    // deployment that mounts the model rows at profile root passes the same
    // probe for every session, and one that declares no scoping is unchanged.
    const event = { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":"demo"}' } }

    // 1. Variant form, nothing visible: no tools registry in the process means
    //    no session mounted the family rows, so the event is not observed.
    const closed = new Context()
    await closed.plugin(EvolutionIoRegistry)
    await closed.plugin(NodeIo)
    await closed.plugin(SkillUsageRegistry, { root: await tempRoot('dsh-usage-scoped-off-'), sessionScoped: true })
    await closed.skillUsage.record('demo', 'use')
    closed.emit('session/event', { id: 's1' } as never, event as never)
    await new Promise(resolve => setTimeout(resolve, 150))
    expect((await closed.skillUsage.report()).get('demo')?.view_count ?? 0).toBe(0)

    // 2. Variant form with the family's model tool visible (what a preset mount
    //    does for its agents): the same event counts.
    const open = new Context()
    await open.plugin(EvolutionIoRegistry)
    await open.plugin(NodeIo)
    open.provide('tools', { get: (name: string) => (name === 'skill_manage' ? { name } : undefined) })
    await open.plugin(SkillUsageRegistry, { root: await tempRoot('dsh-usage-scoped-on-'), sessionScoped: true })
    await open.skillUsage.record('demo', 'use')
    open.emit('session/event', { id: 's1' } as never, event as never)
    open.emit('session/event', { id: 's1' } as never, toolResult('c1'))
    let views = 0
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      views = (await open.skillUsage.report()).get('demo')?.view_count ?? 0
      if (views > 0) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(views).toBe(1)
  })

  it('markArchived sets state without bumping the patch counter', async () => {
    const root = await tempRoot('dsh-usage-archive-')
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
  })

  it('invalidate() re-reads external writes instead of re-covering them', async () => {
    const root = await tempRoot('dsh-usage-invalidate-')
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
    const root = await tempRoot('dsh-usage-observe-')
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
    // S2-P2-12: the view counts at settle — pair the `skill` call with its result.
    ctx.emit('session/event', {} as never, toolResult('c1'))
    await ctx.skillUsage.invalidate()
    const seen = (await ctx.skillUsage.report()).get('demo-read')
    expect(seen?.view_count).toBe(1)
  })

  it('S2-P2-12: a FAILED skill read (isError result) does not count a view', async () => {
    const root = await tempRoot('dsh-usage-failed-read-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root, eventsHome: root })
    await ctx.skillUsage.ensureRecordCreated('failed-read', false)
    ctx.emit('session/event', {} as never, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: JSON.stringify({ name: 'failed-read' }) },
    } as never)
    ctx.emit('session/event', {} as never, {
      type: 'tool/result',
      data: { message: { source: { callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', isError: true }] } },
    } as never)
    await ctx.skillUsage.invalidate()
    expect((await ctx.skillUsage.report()).get('failed-read')?.view_count ?? 0).toBe(0)
  })

  it('S2-P2-12: a call whose result never arrives is not counted (conservative)', async () => {
    const root = await tempRoot('dsh-usage-never-settles-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root, eventsHome: root })
    await ctx.skillUsage.ensureRecordCreated('hanging-read', false)
    ctx.emit('session/event', {} as never, {
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: JSON.stringify({ name: 'hanging-read' }) },
    } as never)
    await ctx.skillUsage.invalidate()
    expect((await ctx.skillUsage.report()).get('hanging-read')?.view_count ?? 0).toBe(0)
  })

  it('S2-P2-12: a PTC end event that reveals its own sub-dispatch counts ONCE even when replayed', async () => {
    // Edge fixed in review: a PTC end event both REVEALS and SETTLES its
    // sub-dispatch when the start frame was dropped — the settle channel must
    // mark it so a duplicated end event cannot count a second view.
    const root = await tempRoot('dsh-usage-ptc-end-replay-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root, eventsHome: root })
    await ctx.skillUsage.ensureRecordCreated('ptc-orphan', false)
    const end = {
      type: 'tool/ptc-dispatch',
      data: { rootCallId: 'r1', parentCallId: 'r1', subCallId: 'r1:ptc:1', name: 'skill', arguments: '{"name":"ptc-orphan"}', isError: false },
    } as never
    ctx.emit('session/event', {} as never, end)
    ctx.emit('session/event', {} as never, end)
    await ctx.skillUsage.invalidate()
    expect((await ctx.skillUsage.report()).get('ptc-orphan')?.view_count ?? 0).toBe(1)
  })

  it('v37 P7a: counts a skill read dispatched inside a run_code program (PTC modality)', async () => {
    const root = await tempRoot('dsh-usage-ptc-')
    // The REAL platform PTC stack: ToolRuntime in 'ptc' mode plus the run_code
    // bridge, with a stub CodeRuntime whose program calls the SDK's skill
    // binding. The sidecar consumes the same session/event stream the platform
    // produces — before P7a it matched 'tool/call', which the PTC bridge never
    // writes, so the view counter stayed at zero and the observation window
    // never opened.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(PtcProbeCodeRuntime)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root, eventsHome: root })
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    ctx.tools.register(PtcSkillTool)
    await ctx.skillUsage.ensureRecordCreated('ptc-read', false)
    const session = ctx.sessions.create(SessionId('usage-ptc'))
    const agent = { id: SessionId('usage-ptc'), session, ctx } as never
    await ctx.tools.execute({
      callId: 'c1', name: 'run_code',
      arguments: { code: 'await tools.skill({name:"ptc-read"})', description: 'read one skill' },
      agent, signal: new AbortController().signal,
    } as never)
    await ctx.skillUsage.invalidate()
    expect((await ctx.skillUsage.report()).get('ptc-read')?.view_count).toBe(1)
    const { events } = await readEvolutionTimeline(nodeEvolutionIo(), eventsFile(root))
    expect(events.filter(event => event.type === 'usage')).toHaveLength(1)
  })

  it('appends the observation-window anchor once, on the first observed read (C)', async () => {
    const root = await tempRoot('dsh-usage-anchor-')
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
      ctx.emit('session/event', {} as never, toolResult(`c${step}`))
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
  })

  it('does not mint a usage record for a read of an unknown skill (A2 guard)', async () => {
    const root = await tempRoot('dsh-usage-no-mint-')
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
  })

  it('skips malformed tool/call events without throwing and without counting (E-65)', async () => {
    const root = await tempRoot('dsh-usage-malformed-')
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
  })

  it('F-203: JSON-null arguments do not throw and do not count as a read', async () => {
    const root = await tempRoot('dsh-usage-null-')
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
  })

  it('E-70: ensureRecordCreated creates and marks authorship in one atomic write (0.3.18)', async () => {
    const root = await tempRoot('dsh-usage-e70-')
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
  })

  it('P1-1 (v15): setFeedbackQuality trims and writes the FEEDBACK-owned fields (no silent drop)', async () => {
    const root = await tempRoot('dsh-usage-n5q-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    await ctx.skillUsage.setFeedbackQuality('  demo  ', 0.42, true)
    const record = (await ctx.skillUsage.report()).get('demo')
    expect(record?.feedback_score).toBe(0.42)
    expect(record?.feedback_warn).toBe(true)
  })

  it('N5 (v12): observeRead counts a whitespace-y tool name against the trimmed key', async () => {
    const root = await tempRoot('dsh-usage-n5v-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.skillUsage.record('demo', 'use')
    // skillNameFromToolCall mirrors the raw arguments `name` (no trim) — the
    // read must land on the trimmed sidecar key.
    ctx.emit('session/event', { id: 's1' } as never, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":" demo "}' } } as never)
    ctx.emit('session/event', { id: 's1' } as never, toolResult('c1'))
    const deadline = Date.now() + 3000
    let views = 0
    while (Date.now() < deadline) {
      views = (await ctx.skillUsage.report()).get('demo')?.view_count ?? 0
      if (views > 0) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(views).toBe(1)
  })
})

/** Stub CodeRuntime: runs a one-line program that reads ONE skill through the SDK binding. */
class PtcProbeCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'p7a-spec'
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const namespace = request.bindings.find(entry => entry.global === 'tools')
    if (namespace === undefined) return { logs: [], error: { kind: 'exception', message: 'no tools namespace' } }
    const value = await namespace.functions['skill']!({ name: 'ptc-read' })
    return { value, logs: [] }
  }
}

/** The `skill` tool the PTC program reaches through the SDK namespace. */
const PtcSkillTool = defineTool({
  name: 'skill',
  description: 'Load one skill body by name.',
  parameters: { name: { type: 'string', required: true } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { body: { type: 'string', required: true } } },
    render: (_args, value) => [{ type: 'text', text: value.body }],
  },
  async execute() { return { body: 'ptc skill body' } },
})
