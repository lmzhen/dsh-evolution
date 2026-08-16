import { describe, expect, it } from 'vitest'
import { buildLearningGraph } from '../src/index.ts'

describe('learning graph', () => {
  it('links memory entries to skills by token overlap', () => {
    const usage = new Map([['python-testing', {}], ['git-workflow', {}]])
    const graph = buildLearningGraph(usage, ['Project uses python-testing and pytest'])
    expect(graph.edges.some(e => e.type === 'memory_skill' && e.to === 'python-testing')).toBe(true)
  })
})
