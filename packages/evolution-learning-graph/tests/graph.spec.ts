import { describe, expect, it } from 'vitest'
import { buildLearningGraph, graphDensity, memorySnapshotOf, parseGraphNodeId, readMemoryIndex, renderNodeLine, resolveGraphNode } from '../src/index.ts'

describe('learning graph', () => {
  it('links memory entries to skills by token overlap', () => {
    const usage = new Map([['python-testing', {}], ['git-workflow', {}]])
    const graph = buildLearningGraph(usage, ['Project uses python-testing and pytest'])
    expect(graph.edges.some(e => e.type === 'memory_skill' && e.to === 'python-testing')).toBe(true)
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

})
