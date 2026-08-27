import { describe, expect, it } from 'vitest'
import { buildLearningGraph, parseGraphNodeId, resolveGraphNode } from '../src/index.ts'

describe('learning graph', () => {
  it('links memory entries to skills by token overlap', () => {
    const usage = new Map([['python-testing', {}], ['git-workflow', {}]])
    const graph = buildLearningGraph(usage, ['Project uses python-testing and pytest'])
    expect(graph.edges.some(e => e.type === 'memory_skill' && e.to === 'python-testing')).toBe(true)
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
})
