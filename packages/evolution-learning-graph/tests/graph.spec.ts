import { describe, expect, it } from 'vitest'
import { buildLearningGraph, graphDensity, parseGraphNodeId, resolveGraphNode } from '../src/index.ts'

describe('learning graph', () => {
  it('links memory entries to skills by token overlap', () => {
    const usage = new Map([['python-testing', {}], ['git-workflow', {}]])
    const graph = buildLearningGraph(usage, ['Project uses python-testing and pytest'])
    expect(graph.edges.some(e => e.type === 'memory_skill' && e.to === 'python-testing')).toBe(true)
  })

  it('memory nodes use the memory:<source>:<index> id rule for both targets (F15 parity)', () => {
    const usage = new Map([['python-testing', {}]])
    const graph = buildLearningGraph(usage, ['memory fact A'], ['user fact B'])
    expect(graph.nodes.some(node => node.id === 'memory:memory:0')).toBe(true)
    expect(graph.nodes.some(node => node.id === 'memory:user:0' && node.label === 'user fact B')).toBe(true)
    // Every generated id must round-trip through the parser (fixes the
    // builder/parser mismatch where `graph detail memory:0` failed).
    for (const node of graph.nodes) {
      if (node.kind === 'memory') expect(parseGraphNodeId(node.id)).not.toBeNull()
    }
  })

  it('parses node ids: skill names and memory:<source>:<index>', () => {
    expect(parseGraphNodeId('python-testing')).toEqual({ kind: 'skill', name: 'python-testing' })
    expect(parseGraphNodeId('memory:user:3')).toEqual({ kind: 'memory', source: 'user', index: 3 })
    expect(parseGraphNodeId('memory:memory:0')).toEqual({ kind: 'memory', source: 'memory', index: 0 })
    expect(parseGraphNodeId('memory:user:')).toBeNull()
    expect(parseGraphNodeId('INVALID NAME')).toBeNull()
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

})
