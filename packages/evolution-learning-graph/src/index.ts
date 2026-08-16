/**
 * Learning graph over skills and memory.
 * @module @deepseek-ai/dsh-evolution-learning-graph
 */

import type { Context } from '@deepseek-ai/cordis'

export interface GraphNode {
  id: string
  kind: 'skill' | 'memory'
  label: string
}

export interface GraphEdge {
  from: string
  to: string
  type: 'related' | 'memory_skill'
}

export interface LearningGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Build a small deterministic graph from usage records and memory entries. */
export function buildLearningGraph(
  usage: ReadonlyMap<string, { use_count?: number; pinned?: boolean }>,
  memoryEntries: readonly string[],
): LearningGraph {
  const nodes: GraphNode[] = [...usage.keys()].map(name => ({
    id: name,
    kind: 'skill' as const,
    label: name,
  }))
  const edges: GraphEdge[] = []
  const sorted = [...usage.keys()].sort()
  for (let i = 1; i < sorted.length; i += 1) {
    edges.push({ from: sorted[i - 1]!, to: sorted[i]!, type: 'related' })
  }
  memoryEntries.forEach((entry, index) => {
    const id = `memory:${index}`
    nodes.push({ id, kind: 'memory', label: entry.split('\n')[0]?.slice(0, 80) ?? id })
    const token = entry.toLowerCase()
    for (const name of sorted) {
      if (name && token.includes(name.toLowerCase())) edges.push({ from: id, to: name, type: 'memory_skill' })
    }
  })
  return { nodes, edges }
}

export const name = 'evolution-learning-graph'

export function apply(ctx: Context): void {
  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: { register(definition: unknown): () => void } }).commands
    commands.register({
      name: 'evolution graph',
      description: 'Show the current learning graph',
      recordInput: false,
      handler: async () => {
        const usage = ctx.get('skillUsage') as { report(): Promise<Map<string, unknown>> } | undefined
        const memory = ctx.get('memory') as { read(target: 'memory' | 'user'): Promise<string[]> } | undefined
        if (!usage || !memory) return { text: 'skill-usage or memory service is not mounted.' }
        const usageMap = await usage.report()
        const memoryEntries = await memory.read('memory')
        const graph = buildLearningGraph(usageMap as unknown as Map<string, { use_count?: number; pinned?: boolean }>, memoryEntries)
        const lines = graph.nodes.map(node => (node.kind === 'memory' ? '◆' : '●') + ' ' + node.label)
        const edges = graph.edges.map(edge => edge.from + ' --' + edge.type + '--> ' + edge.to)
        return { text: lines.join('\n') + '\n\n' + edges.join('\n') }
      },
    })
  })
}
