/**
 * Learning graph over skills and memory, plus node-level commands
 * (`/evolution graph [detail|edit|delete] <nodeId>`) aligned with the Hermes
 * journey surface: a skill node is its name, a memory node is
 * `memory:<source>:<index>` (source = memory|user, index = position in that
 * file's entries). Memory node ids carry a trailing snapshot token so
 * edit/delete can reject a stale index (E-21).
 * @module @deepseek-ai/dsh-evolution-learning-graph
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import z from '@deepseek-ai/schemastery'
import { SKILL_NAME_RE, evolutionIoAdapter, relatedSkillNames, resolveOrigins, resolveSkillsRoot, SkillLibrary, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

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
 * Render one node's display line for `/evolution graph`.
 *
 * A skill node's id IS its name, so `● <name>` already addresses it — an
 * isolated skill (no edge) is addressable by name alone. A memory node's id
 * is the `memory:<source>:<index>:<snapshot>` string `buildLearningGraph`
 * emits, so the id is appended in brackets: an isolated memory node (no edge
 * carrying its id) is otherwise unaddressable from the render. The full id is
 * shown (not the bare `memory:<source>:<index>` prefix) so it matches the id
 * form the edge lines render and so the trailing snapshot — the E-21 token the
 * mutation commands use to reject a stale index — survives the copy/paste
 * (F-322). A bare prefix would round-trip through `parseGraphNodeId` but would
 * silently skip the E-21 drift guard in `readMemoryIndex`.
 */
export function renderNodeLine(node: GraphNode): string {
  if (node.kind === 'skill') return '● ' + node.label
  return '◆ ' + node.label + '  [id: ' + node.id + ']'
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
  usage: ReadonlyMap<string, unknown>,
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
      // E-72 (D-9): `split('\n')[0]` is never undefined (a string always
      // splits into at least one element), so the former `?? id` fallback was
      // unreachable and is gone; an empty entry just yields an empty label.
      const label = (entry.split('\n')[0] ?? '').slice(0, 80)
      // E-21: id carries the label snapshot so edit/delete detect index drift.
      const id = `memory:${source}:${index}:${memorySnapshotOf(label)}`
      nodes.push({ id, kind: 'memory', label })
      // E-72: word-level matching, not substring. Split the entry into word
      // tokens on non-letter/digit/hyphen runs (a hyphenated skill name like
      // `python-testing` stays one token) and require the skill name to be a
      // whole token — so skill `run` no longer links "running"/"grunt".
      const words = new Set(entry.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean))
      for (const name of sorted) {
        if (name && words.has(name.toLowerCase())) edges.push({ from: id, to: name, type: 'memory_skill' })
      }
    })
  }
  appendMemory('memory', memoryEntries)
  appendMemory('user', userEntries)
  return { nodes, edges }
}

export type GraphNodeId =
  | { kind: 'skill'; name: string }
  | { kind: 'memory'; source: 'memory' | 'user'; index: number; snapshot?: string }

/**
 * E-21 snapshot token: a deterministic 8-hex-char digest of a memory entry's
 * rendered label (first line, first 80 chars). The graph builder embeds it in
 * the memory node id so a later edit/delete can detect index drift — any
 * memory write between the last render and the command shifts `memory:<source>:<index>`
 * positions, and the token lets the command reject a stale index instead of
 * mutating the wrong entry. FNV-1a (no imports, cross-platform).
 */
export function memorySnapshotOf(entry: string): string {
  // `[0]` is never undefined (split always yields one element); asserted for
  // noUncheckedIndexedAccess — see buildLearningGraph (E-72 / D-9).
  const label = (entry.split('\n')[0] ?? '').slice(0, 80)
  let hash = 0x811c9dc5
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(-8)
}

export interface MemoryIndexCheck {
  ok: boolean
  /** The current entry at the index, present when ok. */
  entry?: string
  message?: string
}

/**
 * E-21 TOCTOU guard for a memory node operation. Re-reads the entry at
 * `parsed.index` and, when the id carries a snapshot token, verifies the
 * current entry's label still matches it. A mismatch means a memory write
 * shifted the index between the last `/graph` render and this command, so the
 * operation is refused (the caller surfaces "re-run /graph"). A missing
 * snapshot (a hand-typed bare `memory:<source>:<index>` id) skips the check
 * and falls back to operating on whatever currently sits at the index.
 */
export function readMemoryIndex(
  parsed: Extract<GraphNodeId, { kind: 'memory' }>,
  entries: readonly string[],
): MemoryIndexCheck {
  const entry = entries[parsed.index]
  if (entry === undefined) {
    return { ok: false, message: `Memory ${parsed.source}[${parsed.index}] does not exist (${entries.length} entries).` }
  }
  if (parsed.snapshot !== undefined && memorySnapshotOf(entry) !== parsed.snapshot) {
    return { ok: false, message: `Memory ${parsed.source}[${parsed.index}] changed since the graph was rendered; run /graph again and retry.` }
  }
  return { ok: true, entry }
}

/**
 * Parse a graph node id: skill names pass through; `memory:<source>:<index>`
 * becomes a memory node. An optional trailing `:<snapshot>` (the E-21
 * `memorySnapshotOf` token the builder embeds) is carried so edit/delete can
 * detect index drift; a bare index id (hand-typed) still parses with no
 * snapshot and skips the drift check.
 */
export function parseGraphNodeId(id: string): GraphNodeId | null {
  const memory = /^memory:(memory|user):(\d+)(?::([0-9a-f]{8}))?$/.exec(id)
  if (memory) {
    return {
      kind: 'memory',
      source: memory[1] as 'memory' | 'user',
      index: Number(memory[2]),
      ...(memory[3] !== undefined ? { snapshot: memory[3] } : {}),
    }
  }
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

/**
 * E-26 approval seam (soft-probed, mirrors tool-skill-manage): graph skill
 * mutations route through the same `evolutionApproval.request` gate. The
 * staged `args` use the skill_manage runner's shape so the runner tool-skill-
 * manage registers for `kind: 'skill'` replays them on approve.
 */
// 0.3.19 (W1.2): ApprovalLike is imported from evolution-approval (the one
// authoritative consumer shape) instead of this local view.

export const name = 'evolution-learning-graph'

export interface Config {
  /** V10-11 (P2-7): skill tree root for graph reads/edits; empty (default)
   * resolves through `resolveSkillsRoot` to the shared default root. Keeps
   * the graph on the SAME skills tree the tools/catalog read under a
   * custom-root deployment (previously the default root was hardcoded). */
  root?: string
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
})

/**
 * F-10: rendered-line cap for the `/graph` directory — nodes span the
 * whole usage set plus every memory entry and the edge list is a full join, so
 * a large library used to produce an unbounded command result. Nodes and edges
 * are each capped at this many lines (the density footer always renders the
 * true totals); overflow shows a `…N more` marker instead.
 */
export const GRAPH_RENDER_LINE_CAP = 200

/** Join lines under the render cap; overflow is summarized, not dropped silently. */
export function capRenderedLines(lines: string[]): string {
  if (lines.length <= GRAPH_RENDER_LINE_CAP) return lines.join('\n')
  return [...lines.slice(0, GRAPH_RENDER_LINE_CAP), `…${lines.length - GRAPH_RENDER_LINE_CAP} more`].join('\n')
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  // V10-11 (P2-7): single root resolution for every graph skill read/edit —
  // empty config falls through to the shared default root inside the resolver.
  const graphSkillsRoot = resolveSkillsRoot(rawConfig)
  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: { register(definition: unknown): () => void } }).commands
    // M-11 (v3 audit): the register disposer must be bound to the fiber — an
    // unbound registration survives HMR/reload and duplicates the command.
    commandCtx.effect(() => commands.register({
      name: 'graph',
      description: 'Show the learning graph, or act on a node: graph [detail|edit|delete] <nodeId>',
      recordInput: false,
      // input declaration (same fix as /evolution, 2026-08-31): the frontend
      // drops every argument after the first word for commands without it —
      // /graph detail <id> submitted as the bare /graph.
      input: {
        hint: '[detail|edit|delete] <nodeId> [text]',
      },
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
          // F-10: bound the rendered output — node lines cover the
          // whole usage set plus every memory entry, and edge lines are the
          // full join; on a large library the command result used to grow
          // unbounded. Each block caps at GRAPH_RENDER_LINE_CAP lines with an
          // explicit …N more marker; the density footer keeps the true totals.
          const nodeBlock = capRenderedLines(graph.nodes.map(node => renderNodeLine(node)))
          const edgeBlock = capRenderedLines(graph.edges.map(edge => edge.from + ' --' + edge.type + '--> ' + edge.to))
          const density = graphDensity(graph)
          const densityLine = `\n\nSkills: ${density.skillNodes} · related edges: ${density.relatedEdges} (${density.edgesPerNode}/node) · isolated: ${density.isolatedPct}%`
          return nodeBlock + '\n\n' + edgeBlock + densityLine
        }

        function withSkills(): SkillLibrary {
          // 0.3.18 (S4.1, E-30): the graph read the COMMON root via undefined —
          // a configured root in other members was silently ignored here,
          // producing graph data from a DIFFERENT skills tree than the one the
          // tools wrote to. Single resolution via resolveSkillsRoot.
          // V10-11 (P2-7): the resolver now reads THIS package's Config.root
          // (empty = the shared default root), so a custom-root deployment no
          // longer has the graph edit/delete write the wrong tree.
          return new SkillLibrary(graphSkillsRoot, evolutionIoAdapter(() => io.provider()), undefined, (event) => { ctx.emit('evolution/skill-mutated', event) })
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
            // E-26: the graph edit is a content mutation and must follow the
            // same approval + telemetry path as skill_manage. Approval is a
            // soft dependency (ctx.get); when absent the write executes
            // directly, unchanged.
            const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
            if (approval) {
              const origins = resolveOrigins(undefined)
              const decision = await approval.request({
                kind: 'skill',
                // The origin field is the approval surface vocabulary
                // ('foreground' | 'background_review'); a command has no
                // session origin channel, so it derives to 'foreground'. The
                // graph surface is marked in the summary so the audit record
                // names where the write came from.
                summary: `graph edit ${parsed.name}`,
                args: { operation: { action: 'update', name: parsed.name, content }, origin: origins.approval, libraryOrigin: origins.library },
                origin: origins.approval,
              })
              if (decision.action === 'staged') return ok(decision.message)
            }
            const result = await withSkills().update(parsed.name, content, 'foreground')
            // E-26: a graph edit is a content patch — bump the patch counter
            // exactly as skill_manage does (previously graph edits never
            // entered the mutation-maturity signal). V4-13: a no-op update
            // (byte-equivalent content, `noop:true`) must NOT count — the
            // skill_manage gate is `result.noop !== true` and the graph branch
            // was only checking `result.ok`, so a redundant re-save inflated
            // the mutation-maturity counter here but not in skill_manage.
            if (result.ok && result.noop !== true) {
              await (usageService as unknown as { record?(name: string, kind: 'patch'): Promise<void> }).record?.(parsed.name, 'patch')
            }
            return result.ok ? ok(result.message) : err(result.message)
          }
          // E-21 memory TOCTOU: re-read the current index and verify the
          // snapshot token still matches before mutating, so a memory write
          // between the last render and this edit cannot shift the target.
          const entries = await memory.read(parsed.source)
          const check = readMemoryIndex(parsed, entries)
          if (!check.ok) return err(check.message ?? 'Memory index check failed.')
          const result = await memory.applyBatch(parsed.source, [{ action: 'replace', old_text: check.entry ?? '', facts: content }])
          return result.ok ? ok(result.message) : err(result.message)
        }

        async function nodeDelete(id: string): Promise<{ kind: 'success' | 'error'; text: string }> {
          const parsed = parseGraphNodeId(id)
          if (parsed === null) return err(`Invalid node id "${id}". Skill names or memory:<source>:<index> expected.`)
          if (parsed.kind === 'skill') {
            // E-26: same approval gate as edit/delete via skill_manage; the
            // archived markArchived telemetry below was already written back
            // (the audit's noted gap was approval + the edit patch counter).
            const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
            if (approval) {
              const origins = resolveOrigins(undefined)
              const decision = await approval.request({
                kind: 'skill',
                summary: `graph delete ${parsed.name}`,
                args: { operation: { action: 'delete', name: parsed.name }, origin: origins.approval, libraryOrigin: origins.library },
                origin: origins.approval,
              })
              if (decision.action === 'staged') return ok(decision.message)
            }
            const result = await withSkills().archive(parsed.name)
            if (result.ok) {
              const usageRegistry = usageService as unknown as { markArchived?(name: string): Promise<void> } | undefined
              await usageRegistry?.markArchived?.(parsed.name)
            }
            return result.ok ? ok(result.message) : err(result.message)
          }
          // E-21 memory TOCTOU guard (same as edit).
          const entries = await memory.read(parsed.source)
          const check = readMemoryIndex(parsed, entries)
          if (!check.ok) return err(check.message ?? 'Memory index check failed.')
          const result = await memory.applyBatch(parsed.source, [{ action: 'remove', old_text: check.entry ?? '' }])
          return result.ok ? ok(result.message) : err(result.message)
        }
      },
    }), 'evolution-learning-graph.command')
  })
}
