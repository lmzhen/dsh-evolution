/**
 * Learning graph over skills and memory, plus node-level commands
 * (`/evolution graph [detail|edit|delete] <nodeId>`) aligned with the Hermes
 * journey surface: a skill node is its name, a memory node is
 * `memory:<source>:<index>` (source = memory|user, index = position in that
 * file's entries).
 * @module @deepseek-ai/dsh-evolution-learning-graph
 */

import type { Context } from '@deepseek-ai/cordis'
import { SKILL_NAME_RE, evolutionIoAdapter, relatedSkillNames, SkillLibrary, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

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

/**
 * Structural summary of the skill subgraph (Hermes `learning_graph` density
 * parity): edges per skill node and the share of skills no edge touches.
 * Memory nodes are excluded — they carry token-matched edges by construction,
 * which would dilute the isolation signal the statistic exists to expose.
 */
export interface GraphDensity {
  skillNodes: number
  relatedEdges: number
  edgesPerNode: number
  isolatedPct: number
}

export function graphDensity(graph: LearningGraph): GraphDensity {
  const linked = new Set<string>()
  let relatedEdges = 0
  for (const edge of graph.edges) {
    if (edge.type !== 'related') continue
    relatedEdges += 1
    linked.add(edge.from)
    linked.add(edge.to)
  }
  const skillNodes = graph.nodes.filter(node => node.kind === 'skill').length
  const isolated = graph.nodes.filter(node => node.kind === 'skill' && !linked.has(node.id)).length
  return {
    skillNodes,
    relatedEdges,
    edgesPerNode: skillNodes === 0 ? 0 : Math.round((relatedEdges / skillNodes) * 100) / 100,
    isolatedPct: skillNodes === 0 ? 0 : Math.round((isolated / skillNodes) * 100),
  }
}

/**
 * Build a small deterministic graph from usage records and memory entries.
 * Memory node ids follow `memory:<source>:<index>` (source = memory|user,
 * index = position in that file's entries) — the SAME rule the parser
 * `parseGraphNodeId` accepts, so graph detail/edit/delete round-trips.
 *
 * Skill-skill edges are semantic only (B-line G3): each entry of `related`
 * (skill name -> names its frontmatter references, from
 * `relatedSkillNames`) becomes an edge when BOTH endpoints exist in the
 * usage set, self-edges are dropped and undirected duplicates collapse. An
 * omitted `related` yields no skill-skill edges — the former alphabet-order
 * chain was a placeholder that connected unrelated neighbors.
 */
export function buildLearningGraph(
  usage: ReadonlyMap<string, { use_count?: number; pinned?: boolean }>,
  memoryEntries: readonly string[],
  userEntries: readonly string[] = [],
  related?: ReadonlyMap<string, readonly string[]>,
): LearningGraph {
  const nodes: GraphNode[] = [...usage.keys()].map(name => ({
    id: name,
    kind: 'skill' as const,
    label: name,
  }))
  const edges: GraphEdge[] = []
  const sorted = [...usage.keys()].sort()
  const seenPairs = new Set<string>()
  for (const [from, targets] of related ?? []) {
    if (!usage.has(from)) continue
    for (const to of targets) {
      if (to === from || !usage.has(to)) continue
      const pairKey = [from, to].sort().join('->')
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      edges.push({ from, to, type: 'related' })
    }
  }
  const appendMemory = (source: 'memory' | 'user', entries: readonly string[]): void => {
    entries.forEach((entry, index) => {
      const id = `memory:${source}:${index}`
      nodes.push({ id, kind: 'memory', label: entry.split('\n')[0]?.slice(0, 80) ?? id })
      const token = entry.toLowerCase()
      for (const name of sorted) {
        if (name && token.includes(name.toLowerCase())) edges.push({ from: id, to: name, type: 'memory_skill' })
      }
    })
  }
  appendMemory('memory', memoryEntries)
  appendMemory('user', userEntries)
  return { nodes, edges }
}

export type GraphNodeId =
  | { kind: 'skill'; name: string }
  | { kind: 'memory'; source: 'memory' | 'user'; index: number }

/** Parse a graph node id: skill names pass through; `memory:<source>:<index>` becomes a memory node. */
export function parseGraphNodeId(id: string): GraphNodeId | null {
  const memory = /^memory:(memory|user):(\d+)$/.exec(id)
  if (memory) return { kind: 'memory', source: memory[1] as 'memory' | 'user', index: Number(memory[2]) }
  if (SKILL_NAME_RE.test(id)) return { kind: 'skill', name: id }
  return null
}

/** Resolve a parsed node to its current content (read-only). */
export async function resolveGraphNode(
  parsed: GraphNodeId,
  repository: {
    readSkill(name: string): Promise<string | null>
    readMemory(target: 'memory' | 'user'): Promise<string[]>
  },
): Promise<{ ok: boolean; message: string }> {
  if (parsed.kind === 'skill') {
    const content = await repository.readSkill(parsed.name)
    return content === null
      ? { ok: false, message: `Skill "${parsed.name}" not found.` }
      : { ok: true, message: content }
  }
  const entries = await repository.readMemory(parsed.source)
  const entry = entries[parsed.index]
  return entry === undefined
    ? { ok: false, message: `Memory ${parsed.source}[${parsed.index}] does not exist (${entries.length} entries).` }
    : { ok: true, message: entry }
}

interface MemoryLike {
  read(target: 'memory' | 'user'): Promise<string[]>
  applyBatch(target: 'memory' | 'user', operations: Array<{ action: 'replace' | 'remove'; old_text: string; facts?: string }>): Promise<{ ok: boolean; message: string }>
}

export const name = 'evolution-learning-graph'

export function apply(ctx: Context): void {
  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: { register(definition: unknown): () => void } }).commands
    commands.register({
      name: 'graph',
      description: 'Show the learning graph, or act on a node: graph [detail|edit|delete] <nodeId>',
      recordInput: false,
      handler: async (invocation: { rawInput?: string }) => {
        const ok = (text: string) => ({ kind: 'success' as const, text })
        const err = (text: string) => ({ kind: 'error' as const, text })
        const usageService = ctx.get('skillUsage') as { report(): Promise<ReadonlyMap<string, { use_count?: number; pinned?: boolean }>> } | undefined
        const memoryService = ctx.get('memory') as MemoryLike | undefined
        const ioService = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
        if (!usageService || !memoryService || !ioService) return err('skill-usage, memory or evolution-io service is not mounted.')
        const usage = usageService
        const memory = memoryService
        const io = ioService
        const input = (invocation.rawInput ?? '').trim()
        const detail = /^detail\s+(\S+)$/.exec(input)
        if (detail && detail[1]) return await nodeDetail(detail[1])
        const edit = /^edit\s+(\S+)\s+([\s\S]+)$/.exec(input)
        if (edit && edit[1] && edit[2] !== undefined) return await nodeEdit(edit[1], edit[2])
        const remove = /^delete\s+(\S+)$/.exec(input)
        if (remove && remove[1]) return await nodeDelete(remove[1])
        const directory = await renderGraph()
        if (input !== '') return err(`Unknown graph subcommand "${input.split(' ')[0]}". ${directory}`)
        return ok(directory)

        async function renderGraph(): Promise<string> {
          const usageMap = await usage.report()
          const memoryEntries = await memory.read('memory')
          const userEntries = await memory.read('user')
          // Semantic skill-skill edges (B-line G3): read each usage-known
          // skill and collect its related_skills through the shared parser —
          // the same source the quality references factor uses.
          const skills = withSkills()
          const related = new Map<string, string[]>()
          for (const name of usageMap.keys()) {
            const content = await skills.read(name)
            if (content === null) continue
            related.set(name, relatedSkillNames(content, name))
          }
          const graph = buildLearningGraph(usageMap, memoryEntries, userEntries, related)
          const lines = graph.nodes.map(node => (node.kind === 'memory' ? '◆' : '●') + ' ' + node.label)
          const edges = graph.edges.map(edge => edge.from + ' --' + edge.type + '--> ' + edge.to)
          const density = graphDensity(graph)
          const densityLine = `\n\nSkills: ${density.skillNodes} · related edges: ${density.relatedEdges} (${density.edgesPerNode}/node) · isolated: ${density.isolatedPct}%`
          return lines.join('\n') + '\n\n' + edges.join('\n') + densityLine
        }

        function withSkills(): SkillLibrary {
          return new SkillLibrary(undefined, evolutionIoAdapter(() => io.provider()))
        }

        async function nodeDetail(id: string): Promise<{ kind: 'success' | 'error'; text: string }> {
          const parsed = parseGraphNodeId(id)
          if (parsed === null) return err(`Invalid node id "${id}". Skill names or memory:<source>:<index> expected.`)
          const resolved = await resolveGraphNode(parsed, {
            readSkill: (name: string) => withSkills().read(name),
            readMemory: (target: 'memory' | 'user') => memory.read(target),
          })
          return resolved.ok ? ok(resolved.message) : err(resolved.message)
        }

        async function nodeEdit(id: string, content: string): Promise<{ kind: 'success' | 'error'; text: string }> {
          const parsed = parseGraphNodeId(id)
          if (parsed === null) return err(`Invalid node id "${id}". Skill names or memory:<source>:<index> expected.`)
          if (parsed.kind === 'skill') {
            const result = await withSkills().update(parsed.name, content, 'foreground')
            return result.ok ? ok(result.message) : err(result.message)
          }
          const entries = await memory.read(parsed.source)
          const entry = entries[parsed.index]
          if (entry === undefined) return err(`Memory ${parsed.source}[${parsed.index}] does not exist (${entries.length} entries).`)
          const result = await memory.applyBatch(parsed.source, [{ action: 'replace', old_text: entry, facts: content }])
          return result.ok ? ok(result.message) : err(result.message)
        }

        async function nodeDelete(id: string): Promise<{ kind: 'success' | 'error'; text: string }> {
          const parsed = parseGraphNodeId(id)
          if (parsed === null) return err(`Invalid node id "${id}". Skill names or memory:<source>:<index> expected.`)
          if (parsed.kind === 'skill') {
            const result = await withSkills().archive(parsed.name)
            if (result.ok) {
              const usageRegistry = usageService as unknown as { markArchived?(name: string): Promise<void> } | undefined
              await usageRegistry?.markArchived?.(parsed.name)
            }
            return result.ok ? ok(result.message) : err(result.message)
          }
          const entries = await memory.read(parsed.source)
          const entry = entries[parsed.index]
          if (entry === undefined) return err(`Memory ${parsed.source}[${parsed.index}] does not exist (${entries.length} entries).`)
          const result = await memory.applyBatch(parsed.source, [{ action: 'remove', old_text: entry }])
          return result.ok ? ok(result.message) : err(result.message)
        }
      },
    })
  })
}
