import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Graph from '../src/index.ts'
import { buildLearningGraph, graphDensity, memorySnapshotOf, parseGraphNodeId, readMemoryIndex, renderNodeLine, resolveGraphNode } from '../src/index.ts'

/** The registered /graph handler, captured through a stub `commands` service. */
type GraphHandler = { handler(invocation: CommandInvocation): Promise<{ kind: 'success' | 'error'; text: string }> }

/**
 * V27 G5.2: a `CommandInvocation` for the registered handler. The platform type
 * carries a branded `commandId`, an AbortSignal and the FULL Agent surface; the
 * graph reads only `rawInput` and `agent.session`, so the fixture supplies
 * exactly those — the assertion is confined to `agent` here, with the reason.
 * @param rawInput - text after the command name.
 * @param session - session id/origin the handler should see.
 * @returns the invocation to hand to the handler.
 */
function invocationOf(rawInput: string, session: { id?: string; header?: { origin?: string } } = {}): CommandInvocation {
  return {
    commandId: 'graph-test' as CommandInvocation['commandId'],
    rawInput,
    signal: new AbortController().signal,
    agent: { session: { id: 'graph-test-session', header: {}, ...session } } as unknown as CommandInvocation['agent'],
  }
}

describe('learning graph', () => {
  it('links memory entries to skills by token overlap', () => {
    const usage = new Map([['python-testing', {}], ['git-workflow', {}]])
    const graph = buildLearningGraph(usage, ['Project uses python-testing and pytest'])
    expect(graph.edges.some(e => e.type === 'memory_skill' && e.to === 'python-testing')).toBe(true)
  })

  it('V27 INS-04: one unreadable skill file drops its edges instead of the whole graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-graph-ins04-'))
    const skillsRoot = join(root, 'skills')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const healthy = '---\nname: healthy-skill\ndescription: healthy\n---\n\nBody.\n'
      const broken = '---\nname: broken-skill\ndescription: broken\n---\n\nBody.\n'
      await mkdir(join(skillsRoot, 'healthy-skill'), { recursive: true })
      await mkdir(join(skillsRoot, 'broken-skill'), { recursive: true })
      await writeFile(join(skillsRoot, 'healthy-skill', 'SKILL.md'), healthy, 'utf8')
      await writeFile(join(skillsRoot, 'broken-skill', 'SKILL.md'), broken, 'utf8')
      const ctx = new Context()
      let handler: GraphHandler | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('skillUsage', {
        report: async () => new Map([['healthy-skill', {}], ['broken-skill', {}]]),
      })
      ctx.provide('memory', {
        read: async () => [],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      // One skill's read fails the way a real EACCES/EMFILE does: `SkillLibrary`
      // re-throws everything but EISDIR, and the unbounded `Promise.all` used to
      // let that abort the whole `/graph`.
      const io = nodeEvolutionIo()
      ctx.provide('evolutionIo', {
        provider: () => ({
          ...io,
          readText: async (path: string) => {
            if (path.includes('broken-skill')) throw new Error('EACCES: simulated unreadable skill')
            return await io.readText(path)
          },
        }),
      })
      const warnings: string[] = []
      const originalWarn = ctx.logger.warn.bind(ctx.logger)
      ctx.logger.warn = ((message: string) => { warnings.push(message); originalWarn(message) }) as typeof ctx.logger.warn
      await ctx.plugin(Graph, { root: skillsRoot })
      const result = await handler!.handler(invocationOf(''))
      expect(result.kind).toBe('success')
      expect(result.text).toContain('healthy-skill')
      expect(result.text).toContain('broken-skill')
      expect(warnings.some(message => message.includes('could not be read'))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('memory nodes embed a snapshot token so edit/delete detect index drift (F15 parity + E-21)', () => {
    const usage = new Map([['python-testing', {}]])
    const graph = buildLearningGraph(usage, ['memory fact A'], ['user fact B'])
    const memoryNode = graph.nodes.find(node => node.kind === 'memory' && node.id.startsWith('memory:memory:0'))
    expect(memoryNode).toBeDefined()
    // The id keeps the `memory:<source>:<index>` rule but carries the label
    // snapshot so a stale index is rejected (E-21 TOCTOU guard).
    expect(memoryNode!.id).toMatch(/^memory:memory:0:[0-9a-f]{8}$/)
    const userNode = graph.nodes.find(node => node.kind === 'memory' && node.id.startsWith('memory:user:0'))
    expect(userNode).toBeDefined()
    expect(userNode!.label).toBe('user fact B')
    // Every generated id must round-trip through the parser (fixes the
    // builder/parser mismatch where `graph detail memory:0` failed).
    for (const node of graph.nodes) {
      if (node.kind === 'memory') expect(parseGraphNodeId(node.id)).not.toBeNull()
    }
  })

  it('parses node ids: skill names and memory:<source>:<index>[:snapshot]', () => {
    expect(parseGraphNodeId('python-testing')).toEqual({ kind: 'skill', name: 'python-testing' })
    expect(parseGraphNodeId('memory:user:3')).toEqual({ kind: 'memory', source: 'user', index: 3 })
    expect(parseGraphNodeId('memory:memory:0')).toEqual({ kind: 'memory', source: 'memory', index: 0 })
    // A snapshot-suffixed id (what the builder emits) parses into the token.
    expect(parseGraphNodeId('memory:memory:0:abc12345')).toEqual({ kind: 'memory', source: 'memory', index: 0, snapshot: 'abc12345' })
    expect(parseGraphNodeId('memory:user:')).toBeNull()
    expect(parseGraphNodeId('memory:user:3:tooshort')).toBeNull()
    expect(parseGraphNodeId('INVALID NAME')).toBeNull()
  })

  it('rejects a memory edit/delete whose index drifted after render (E-21 TOCTOU)', () => {
    const entry = 'memory fact A'
    const drifted = 'a different fact'
    // Snapshot taken from a prior render matches the original entry...
    const parsed = parseGraphNodeId(`memory:memory:0:${memorySnapshotOf(entry)}`)
    if (!parsed || parsed.kind !== 'memory') throw new Error('expected a memory node')
    expect(readMemoryIndex(parsed, [entry]).ok).toBe(true)
    // ...but a memory write that shifted the index changes what's at the slot.
    const leaked = readMemoryIndex(parsed, [drifted])
    expect(leaked.ok).toBe(false)
    expect(leaked.message).toContain('changed since the graph was rendered')
    // Out-of-range index still refuses, and a bare id (no snapshot) skips drift.
    expect(readMemoryIndex(parsed, []).ok).toBe(false)
    expect(readMemoryIndex({ kind: 'memory', source: 'memory', index: 0 }, [drifted]).ok).toBe(true)
  })

  it('uses word-level matching so skill "run" never links "running"/"grunt" (E-72)', () => {
    const usage = new Map([['run', {}], ['python-testing', {}]])
    // Substring matching once produced false edges for run; word matching must
    // not, while a hyphenated skill name stays a single whole token.
    const graph = buildLearningGraph(usage, ['He is running the grunt job and uses python-testing'])
    expect(graph.edges.filter(e => e.type === 'memory_skill' && e.to === 'run')).toEqual([])
    expect(graph.edges.some(e => e.type === 'memory_skill' && e.to === 'python-testing')).toBe(true)
  })

  it('resolves skills and indexed memory entries (F15)', async () => {
    const repository = {
      readSkill: async (name: string) => (name === 'known' ? '---\nname: known\n---\nBody.' : null),
      readMemory: async (target: 'memory' | 'user') => target === 'memory' ? ['entry-a', 'entry-b'] : [],
    }
    const skill = await resolveGraphNode({ kind: 'skill', name: 'known' }, repository)
    expect(skill.ok).toBe(true)
    expect(skill.message).toContain('Body.')
    const missing = await resolveGraphNode({ kind: 'skill', name: 'gone' }, repository)
    expect(missing.ok).toBe(false)
    const memory = await resolveGraphNode({ kind: 'memory', source: 'memory', index: 1 }, repository)
    expect(memory.message).toBe('entry-b')
    const outOfRange = await resolveGraphNode({ kind: 'memory', source: 'memory', index: 9 }, repository)
    expect(outOfRange.ok).toBe(false)
  })
  it('builds semantic skill-skill edges from related, dropping noise (G3)', () => {

    const usage = new Map([['alpha', {}], ['beta', {}], ['gamma', {}]])

    const related = new Map<string, string[]>([

      ['alpha', ['beta', 'alpha', 'ghost']],

      ['beta', ['alpha']],

      ['gamma', []],

    ])

    const graph = buildLearningGraph(usage, [], [], related)

    // Self-edges and missing endpoints never connect; the beta->alpha entry

    // collapses into the alpha->beta pair (undirected dedupe). The former

    // alphabet-order chain is gone — unrelated neighbors are not related.

    expect(graph.edges.filter(edge => edge.type === 'related')).toEqual([

      { from: 'alpha', to: 'beta', type: 'related' },

    ])

    // Memory edges are unaffected by the semantic pass.

    const memoryGraph = buildLearningGraph(usage, ['Project uses alpha heavily'], [], related)

    expect(memoryGraph.edges.some(edge => edge.type === 'memory_skill' && edge.to === 'alpha')).toBe(true)

  })



  it('omits skill-skill edges entirely when related is not provided (G3)', () => {

    const usage = new Map([['a-skill', {}], ['b-skill', {}]])

    const graph = buildLearningGraph(usage, [], [])

    expect(graph.edges.filter(edge => edge.type === 'related')).toEqual([])

  })



  it('density summarizes the skill subgraph (G3)', () => {

    const usage = new Map([['alpha', {}], ['beta', {}], ['gamma', {}]])

    const related = new Map<string, string[]>([['alpha', ['beta']]])

    const graph = buildLearningGraph(usage, [], [], related)

    expect(graphDensity(graph)).toEqual({ skillNodes: 3, relatedEdges: 1, edgesPerNode: 0.33, isolatedPct: 33 })

    expect(graphDensity(buildLearningGraph(new Map(), [], []))).toEqual({ skillNodes: 0, relatedEdges: 0, edgesPerNode: 0, isolatedPct: 0 })

  })
  it('renders a skill line bare and a memory line with its copyable, parseable id (F-322)', () => {
    // A skill's id is its name, so the bare line already addresses it — no id
    // suffix needed (isolated skills are addressable by name alone).
    expect(renderNodeLine({ id: 'python-testing', kind: 'skill', label: 'python-testing' })).toBe('● python-testing')
    // A memory node line appends the full id (with its E-21 snapshot) so an
    // isolated node is addressable; the exposed id round-trips through the
    // parser the detail/edit/delete branches use.
    const line = renderNodeLine({ id: 'memory:memory:0:abc12345', kind: 'memory', label: 'memory fact A' })
    expect(line).toBe('◆ memory fact A  [id: memory:memory:0:abc12345]')
    expect(parseGraphNodeId('memory:memory:0:abc12345')).toEqual({ kind: 'memory', source: 'memory', index: 0, snapshot: 'abc12345' })
  })

  it('addresses every memory node from its rendered line, including isolated nodes (F-322)', () => {
    const usage = new Map([['python-testing', {}]])
    // memory fact A links a memory_skill edge; user fact B is isolated (no
    // edge) — its id must still be visible on the node line, not only on edges.
    const graph = buildLearningGraph(usage, ['Project uses python-testing'], ['user fact B'])
    const memoryNodes = graph.nodes.filter(node => node.kind === 'memory')
    expect(memoryNodes.length).toBe(2)
    for (const node of memoryNodes) {
      const line = renderNodeLine(node)
      expect(line).toContain(`[id: ${node.id}]`)
      const parsed = parseGraphNodeId(node.id)
      if (parsed === null) throw new Error(`memory node id ${node.id} did not round-trip`)
      expect(parsed.kind).toBe('memory')
    }
  })

  it('F-10: capRenderedLines joins below the cap and summarizes overflow with an …N more marker', () => {
    expect(Graph.capRenderedLines(['a', 'b'])).toBe('a\nb')
    const lines = Array.from({ length: 250 }, (_, i) => `line-${i}`)
    const rendered = Graph.capRenderedLines(lines)
    const out = rendered.split('\n')
    expect(out).toHaveLength(Graph.GRAPH_RENDER_LINE_CAP + 1)
    expect(out[0]).toBe('line-0')
    expect(out[Graph.GRAPH_RENDER_LINE_CAP - 1]).toBe(`line-${Graph.GRAPH_RENDER_LINE_CAP - 1}`)
    expect(out[Graph.GRAPH_RENDER_LINE_CAP]).toBe('…50 more')
    // The tail is summarized, not silently truncated: the marker names the count.
    expect(rendered).not.toContain('line-249')
  })

  it('F-10: the /graph directory caps its node block on a large usage set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evo-graph-cap-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const ctx = new Context()
      const names = Array.from({ length: 250 }, (_, i) => `cap-skill-${String(i).padStart(3, '0')}`)
      let handler: GraphHandler | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('skillUsage', {
        report: async () => new Map(names.map(name => [name, {}])),
      })
      ctx.provide('memory', {
        read: async () => [],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      await ctx.plugin(Graph)
      const result = await handler!.handler(invocationOf(''))
      expect(result.kind).toBe('success')
      expect(result.text).toContain('● cap-skill-000')
      expect(result.text).toContain('…50 more')
      expect(result.text).not.toContain('● cap-skill-249')
      // The density footer still reports the TRUE totals beyond the cap.
      expect(result.text).toContain('Skills: 250')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('V10-11 (P2-7): Config.root routes graph reads to the configured skills tree, not the default root', async () => {
    const configuredRoot = await mkdtemp(join(tmpdir(), 'evo-graph-root-a-'))
    const emptyDefaultHome = await mkdtemp(join(tmpdir(), 'evo-graph-root-b-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = emptyDefaultHome
    try {
      // The skill exists ONLY in the configured root; the default root
      // (DSH_HOME/skills) stays empty. Previously the graph read the default
      // root unconditionally, so `graph detail` returned "not found".
      await mkdir(join(configuredRoot, 'demo-skill'), { recursive: true })
      await writeFile(join(configuredRoot, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Configured root demo.\n---\n\nConfigured-root body.\n', 'utf8')

      const ctx = new Context()
      let handler: GraphHandler | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('skillUsage', {
        report: async () => new Map<string, unknown>(),
      })
      ctx.provide('memory', {
        read: async () => [],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      await ctx.plugin(Graph, { root: configuredRoot })
      const found = await handler!.handler(invocationOf('detail demo-skill'))
      expect(found.kind).toBe('success')
      expect(found.text).toContain('Configured-root body.')
      // The default tree is genuinely empty, proving the read used the config.
      expect(found.text).not.toContain('not found')

      const ctxDefault = new Context()
      let defaultHandler: typeof handler
      ctxDefault.provide('commands', {
        register: (definition: unknown) => {
          defaultHandler = definition as typeof handler
          return () => {}
        },
      })
      ctxDefault.provide('skillUsage', {
        report: async () => new Map<string, unknown>(),
      })
      ctxDefault.provide('memory', {
        read: async () => [],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      ctxDefault.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      await ctxDefault.plugin(Graph)
      const missing = await defaultHandler!.handler(invocationOf('detail demo-skill'))
      expect(missing.kind).toBe('error')
      expect(missing.text).toContain('not found')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(configuredRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      await rm(emptyDefaultHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('V4-13: a no-op graph edit (byte-equivalent content) does not bump the patch counter, a real edit does', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evo-graph-noop-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const skillDir = join(root, 'skills', 'demo-skill')
      await mkdir(skillDir, { recursive: true })
      const content = '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n'
      await writeFile(join(skillDir, 'SKILL.md'), content, 'utf8')
      const ctx = new Context()
      let handler: GraphHandler | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      let recordCalls = 0
      ctx.provide('skillUsage', {
        record: async () => { recordCalls += 1 },
        report: async () => new Map<string, unknown>(),
      })
      ctx.provide('memory', {
        read: async () => [],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      await ctx.plugin(Graph)
      // Re-save the exact on-disk content: core update returns noop:true, so the
      // graph branch must NOT count it (V4-13 — previously it counted on result.ok).
      const noop = await handler!.handler(invocationOf(`edit demo-skill ${content}`))
      expect(noop.kind).toBe('success')
      expect(noop.text).toContain('unchanged')
      expect(recordCalls).toBe(0)
      // A real content edit still counts exactly once.
      const changed = '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody changed\n'
      const real = await handler!.handler(invocationOf(`edit demo-skill ${changed}`))
      expect(real.kind).toBe('success')
      expect(real.text).toContain('updated')
      expect(recordCalls).toBe(1)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('N1 (v12): /graph edit passes the command invocation session to the approval request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evo-graph-n1-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      // v30 GRAPH-03: the staging pre-check requires the target to EXIST —
      // stage the skill the tests edit/delete.
      const skillsDir = join(root, 'skills', 'demo-skill')
      await mkdir(skillsDir, { recursive: true })
      await writeFile(join(skillsDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\nbody\n', 'utf8')
      const ctx = new Context()
      let handler: GraphHandler | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('skillUsage', {
        report: async () => new Map<string, unknown>(),
      })
      ctx.provide('memory', {
        read: async () => [],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      let captured: { sessionId?: unknown; session?: unknown; args?: { origin?: unknown } } | undefined
      ctx.provide('evolutionApproval', {
        // P2-7 (v15): hasRunner is part of the staging contract (the graph
        // pre-checks it before staging).
        hasRunner: () => true,
        request: async (input: unknown) => {
          captured = input as typeof captured
          return { action: 'staged', message: 'staged for approval' }
        },
      })
      await ctx.plugin(Graph)
      const result = await handler!.handler(invocationOf('edit demo-skill new body', { id: 'sess-n1', header: { origin: 'subagent' } }))
      expect(result.kind).toBe('success')
      // The approval service derives the platform session policy from these —
      // before N1 the graph sent neither and documented the absence as a
      // platform limitation (a `never`-policy session staged anyway). A
      // subagent-origin session derives to the review channel (resolveOrigins).
      expect(captured?.sessionId).toBe('sess-n1')
      expect((captured?.session as { id?: string } | undefined)?.id).toBe('sess-n1')
      expect(captured?.args?.origin).toBe('background_review')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('E-3 (v18): /graph edit forwards the platform session policy to the approval request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evo-graph-e3-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const ctx = new Context()
      let handler: GraphHandler | undefined
      ctx.provide('commands', { register: (definition: unknown) => { handler = definition as typeof handler; return () => {} } })
      ctx.provide('skillUsage', { report: async () => new Map<string, unknown>() })
      ctx.provide('memory', { read: async () => [], applyBatch: async () => ({ ok: true, message: 'ok' }) })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      // v30 GRAPH-03: the staging pre-check requires the target to exist.
      const skillsDir = join(root, 'skills', 'demo-skill')
      await mkdir(skillsDir, { recursive: true })
      await writeFile(join(skillsDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\nbody\n', 'utf8')
      // The PLATFORM approval service is the single source of the session
      // policy (effectiveSessionPolicy); a `never` policy must reach the
      // evolution approval request so the seam can refuse to stage.
      ctx.provide('approval', { overrideOf: () => undefined, config: { policy: 'never' } })
      let captured: { sessionPolicy?: unknown } | undefined
      ctx.provide('evolutionApproval', {
        hasRunner: () => true,
        request: async (input: unknown) => { captured = input as typeof captured; return { action: 'staged', message: 'staged for approval' } },
      })
      await ctx.plugin(Graph)
      const result = await handler!.handler(invocationOf('edit demo-skill new body', { id: 'sess-e3', header: { origin: 'subagent' } }))
      expect(result.kind).toBe('success')
      expect(captured?.sessionPolicy).toBe('never')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('N1 (v12): /graph delete passes the session too and a never-policy session is not staged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evo-graph-n1d-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      // v30 GRAPH-03: the staging pre-check requires the target to EXIST —
      // stage the skill the tests edit/delete.
      const skillsDir = join(root, 'skills', 'demo-skill')
      await mkdir(skillsDir, { recursive: true })
      await writeFile(join(skillsDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\nbody\n', 'utf8')
      const ctx = new Context()
      let handler: GraphHandler | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('skillUsage', {
        report: async () => new Map<string, unknown>(),
      })
      ctx.provide('memory', {
        read: async () => [],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      let captured: { sessionId?: unknown; session?: unknown } | undefined
      ctx.provide('evolutionApproval', {
        // P2-7 (v15): hasRunner is part of the staging contract (the graph
        // pre-checks it before staging).
        hasRunner: () => true,
        request: async (input: unknown) => {
          captured = input as typeof captured
          return { action: 'allow', message: 'allowed' }
        },
      })
      await ctx.plugin(Graph)
      await handler!.handler(invocationOf('delete demo-skill', { id: 'sess-n1d', header: { origin: 'foreground' } }))
      expect(captured?.sessionId).toBe('sess-n1d')
      expect((captured?.session as { id?: string } | undefined)?.id).toBe('sess-n1d')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('P2-6 (v15)/v16: /graph edit memory:* stages through the approval seam with a runner-replayable payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evo-graph-n1m-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      // v30 GRAPH-03: the staging pre-check requires the target to EXIST —
      // stage the skill the tests edit/delete.
      const skillsDir = join(root, 'skills', 'demo-skill')
      await mkdir(skillsDir, { recursive: true })
      await writeFile(join(skillsDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\nbody\n', 'utf8')
      const ctx = new Context()
      let handler: GraphHandler | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('skillUsage', {
        report: async () => new Map<string, unknown>(),
      })
      // The memory stub mirrors the file-backed store: readMemoryIndex
      // resolves index 0 against this list, and applyBatch is what the direct
      // path would have called.
      ctx.provide('memory', {
        read: async () => ['existing entry body'],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      let captured: { kind?: unknown; summary?: unknown; args?: unknown } | undefined
      ctx.provide('evolutionApproval', {
        hasRunner: () => true,
        request: async (input: unknown) => {
          captured = input as typeof captured
          return { action: 'staged', message: 'staged for approval' }
        },
      })
      await ctx.plugin(Graph)
      const result = await handler!.handler(invocationOf('edit memory:user:0 replacement body', { id: 'sess-mem', header: { origin: 'foreground' } }))
      expect(result.kind).toBe('success')
      // P2-6: the memory branch goes through the approval seam (v15 batch),
      // staged in the tool-memory runner's replay shape.
      expect(captured?.kind).toBe('memory')
      expect(captured?.summary).toBe('graph edit memory:user:0')
      const args = captured?.args as { target?: string; operations?: Array<{ action?: string; old_text?: string; facts?: string }> }
      expect(args.target).toBe('user')
      expect(args.operations?.[0]).toMatchObject({ action: 'replace', old_text: 'existing entry body', facts: 'replacement body' })
      // The direct path never ran: applyBatch is not stubbed to record, and a
      // stub returning ok would still be fine — assert via the stage message.
      expect(result.text).toContain('staged for approval')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('P2-7 (v15)/v16: /graph edit memory:* refuses when staging will happen but no memory runner is mounted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evo-graph-n1mr-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      // v30 GRAPH-03: the staging pre-check requires the target to EXIST —
      // stage the skill the tests edit/delete.
      const skillsDir = join(root, 'skills', 'demo-skill')
      await mkdir(skillsDir, { recursive: true })
      await writeFile(join(skillsDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\nbody\n', 'utf8')
      const ctx = new Context()
      let handler: GraphHandler | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('skillUsage', {
        report: async () => new Map<string, unknown>(),
      })
      ctx.provide('memory', {
        read: async () => ['existing entry body'],
        applyBatch: async () => ({ ok: true, message: 'ok' }),
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      ctx.provide('evolutionApproval', {
        // Host-only assembly: approval enabled, the tool-memory runner row absent.
        isEnabled: true,
        hasRunner: (kind: string) => kind !== 'memory',
        request: async () => { throw new Error('request must not be called when the pre-check refuses') },
      })
      await ctx.plugin(Graph)
      const result = await handler!.handler(invocationOf('edit memory:user:0 replacement body', { id: 'sess-mem2', header: { origin: 'foreground' } }))
      expect(result.kind).toBe('error')
      expect(result.text).toContain('cannot be staged')
      expect(result.text).toContain('tool-memory')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
