/**
 * dsh-evolution — Hermes-style self-evolution plugin for DeepSeek Harness.
 *
 * Components:
 * - durable MEMORY.md / USER.md memory with a model-facing `memory` tool
 * - `skill_manage` write tool over $DSH_HOME/skills
 * - deterministic post-turn review signal gate
 * - background review via an optional one-shot subagent; falls back to an
 *   injected in-session nudge when no subagent provider is mounted
 * - `.usage.json` skill telemetry and deterministic curator transitions
 * - threat scanning on every agent-authored write
 *
 * @module @deepseek-ai/dsh-evolution
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  advanceReview,
  bumpPatch,
  bumpUse,
  bumpView,
  computeLifecycleTransitions,
  foldTurn,
  JsonState,
  loadUsage,
  markAgentCreated,
  MemoryStore,
  type EvolutionIoLike,
  type MemoryOperation,
  reviewPrompt,
  saveUsage,
  SkillLibrary,
  skillsRoot,
  type ReviewKind,
  type ReviewState,
  type TurnSignals,
} from '@deepseek-ai/dsh-evolution-core'

export const name = 'dsh-evolution'

/** Services required for the model-facing and review paths. */
export const inject = ['tools', 'systemPrompt', 'agents']

export interface Config {
  memoryEnabled?: boolean
  skillManageEnabled?: boolean
  reviewEnabled?: boolean
  reviewMode?: string
  memoryInterval?: number
  skillInterval?: number
  memoryCharLimit?: number
  userCharLimit?: number
  memoryAddDatePrefix?: boolean
  curatorEnabled?: boolean
  curatorStaleAfterDays?: number
  curatorIntervalHours?: number
  curatorArchiveAfterDays?: number
  skillsRootOverride?: string
  /** Tools the one-shot review subagent may use (Anchored Standard defaults). */
  reviewToolAllow?: string[]
}

export const Config: z<Config> = z.object({
  memoryEnabled: z.boolean().default(true),
  skillManageEnabled: z.boolean().default(true),
  reviewEnabled: z.boolean().default(true),
  reviewMode: z.string().default('subagent'),
  memoryInterval: z.number().default(10),
  skillInterval: z.number().default(10),
  memoryCharLimit: z.number().default(2200),
  userCharLimit: z.number().default(1375),
  memoryAddDatePrefix: z.boolean().default(false),
  curatorEnabled: z.boolean().default(true),
  curatorStaleAfterDays: z.number().default(30),
  curatorIntervalHours: z.number().default(168),
  curatorArchiveAfterDays: z.number().default(90),
  skillsRootOverride: z.string().default(''),
  reviewToolAllow: z.array(z.string()).default(['skill', 'skill_search', 'skill_load']),
})

const STATIC_GUIDANCE = `## Hermes Evolution
You have durable memory and a skill library.

- Save stable user facts and preferences with the \`memory\` tool. Prefer batch \`operations\` for consolidation.
- Save reusable procedures with \`skill_manage\` (create/patch/update/archive). Prefer class-level umbrella skills and support files under references/, templates/, or scripts/.
- \`skill\` loads an existing skill read-only. Load applicable skills before acting on their task class.
- Never encode transient environment failures or negative tool claims into memory or skills.`

interface Evidence {
  event_seq?: number | string
  quote?: string
}

interface StructuredPlan {
  memoryOps?: Array<{ target?: string; action?: string; facts?: string; content?: string; old_text?: string; evidence?: Evidence[] }>
  skillOps?: Array<{
    action?: string
    name?: string
    content?: string
    old_string?: string
    new_string?: string
    file_path?: string
    replace_all?: boolean
    absorbed_into?: string
    evidence?: Evidence[]
  }>
  summary?: string
}

interface MemoryToolArgs {
  target?: string
  action?: string
  facts?: string
  content?: string
  old_text?: string
  operations?: Array<{ action: string; facts?: string; content?: string; old_text?: string }>
}

interface SkillToolArgs {
  action?: string
  name?: string
  content?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
  file_path?: string
  file_content?: string
  absorbed_into?: string
}

interface ApprovalLike {
  request(input: {
    kind: 'memory' | 'skill'
    summary: string
    args: unknown
    origin: 'foreground' | 'background_review'
  }): Promise<{ action: 'allow' | 'staged'; pendingId?: string; message: string }>
  registerRunner(kind: 'memory' | 'skill', runner: (args: unknown) => Promise<{ ok: boolean; message: string }>): () => void
}

interface SubagentRunLike {
  id: SessionId
  result: Promise<{ structured?: unknown; output: unknown[]; stopReason: string }>
  dispose(): Promise<void>
}

interface SubagentServiceLike {
  start(name: string, request: unknown): Promise<SubagentRunLike>
}

interface ToolMemoryResult {
  ok: boolean
  message: string
  entries: string[]
  chars: number
  limit: number
  pending_id?: string
}

interface ToolSkillResult {
  ok: boolean
  message: string
  skills: Array<{ name: string; description: string }>
  path?: string
  pending_id?: string
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  return ''
}

function isStructuredPlan(value: unknown): value is StructuredPlan {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.memoryOps) || Array.isArray(record.skillOps) || typeof record.summary === 'string'
}

export function apply(ctx: Context, rawConfig: Config): void {
  const config = rawConfig as Required<Config>
  const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
  const evolutionIo = ioRegistry ? {
    readText: (path: string) => ioRegistry.provider().readText(path),
    writeText: (path: string, content: string) => ioRegistry.provider().writeText(path, content),
    remove: (path: string) => ioRegistry.provider().remove(path),
    list: (path: string) => ioRegistry.provider().list(path),
    exists: (path: string) => ioRegistry.provider().exists(path),
    rename: (path: string, destination: string) => ioRegistry.provider().rename(path, destination),
    copy: (path: string, destination: string) => ioRegistry.provider().copy(path, destination),
  } : undefined
  const memory = new MemoryStore({
    memoryCharLimit: config.memoryCharLimit,
    userCharLimit: config.userCharLimit,
    addDatePrefix: config.memoryAddDatePrefix,
    ...evolutionIo ? { io: evolutionIo } : {},
  })
  const skillsRootOverride = rawConfig.skillsRootOverride || skillsRoot()
  const skills = evolutionIo
    ? new SkillLibrary(skillsRootOverride, evolutionIo)
    : new SkillLibrary(skillsRootOverride)
  let memoryContextText = ''

  // Phase 1: monotonic control-plane guard. Policy is plugin config/state,
  // never model-writable data. The guard runs before every tool body and is
  // final: later listeners cannot turn a denial back into permission.
  const policy = ctx.get('evolutionPolicy') as {
    guardReason(toolName: string, args: unknown): string | undefined
  } | undefined
  if (policy) {
    ctx.tools.guard(exec => policy.guardReason(exec.name, exec.arguments))
  }

  async function refreshMemoryContext(): Promise<void> {
    memoryContextText = await memory.renderContext()
  }

  void refreshMemoryContext()

  // ── Prompt layers: static guidance is cache-stable; memory is an
  //    append-only runtime-context snapshot that only changes on write.
  ctx.systemPrompt.section({ name: 'evolution:guidance', order: 150, text: STATIC_GUIDANCE })
  ctx.systemPrompt.context({ name: 'evolution:memory', order: 150, text: () => memoryContextText })

  // ── Memory tool ─────────────────────────────────────────────
  if (config.memoryEnabled && !ctx.tools.get('memory')) {
    ctx.tools.register(defineTool({
      name: 'memory',
      description:
        'Save durable facts to persistent memory that survives across sessions. '
        + 'Use the operations array for ALL changes in ONE atomic call. '
        + 'target "user" = who the user is; target "memory" = your notes about environment, conventions, and lessons. '
        + 'Save proactively for preferences, corrections, personal details, and stable environment facts. '
        + 'Do NOT save task progress, raw data, temporary TODO state, or one-off narratives. '
        + 'If full, remove or shorten stale entries in the same batch to make room.',
      parameters: {
        target: {
          type: 'string',
          enum: ['memory', 'user'],
          required: true,
          description: 'Which store to write.',
        },
        action: {
          type: 'string',
          enum: ['add', 'replace', 'remove'],
          description: 'Single-op shape. Omit when using operations.',
        },
        facts: { type: 'string', description: 'Entry content for add/replace. Alias for content.' },
        content: { type: 'string', description: 'Hermes-compatible entry content for add/replace. Prefer facts.' },
        old_text: { type: 'string', description: 'Substring identifying the entry for replace/remove.' },
        operations: {
          type: 'array',
          description: 'Batch shape: atomic operations applied against the final char budget.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', enum: ['add', 'replace', 'remove'], required: true },
              facts: { type: 'string' },
              old_text: { type: 'string' },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            message: { type: 'string', required: true },
            entries: { type: 'array', required: true, items: { type: 'string' } },
            chars: { type: 'integer', required: true },
            limit: { type: 'integer', required: true },
            pending_id: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `${value.ok ? 'OK' : 'Error'}: ${value.message} (${value.chars}/${value.limit} chars)`
            + (value.ok || value.entries.length === 0
              ? ''
              : '\nCurrent entries:\n' + value.entries.map((entry, index) => `  ${index + 1}. ${entry}`).join('\n')),
        }],
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        return gateMemory(args)
      },
    }))
  }

  async function gateMemory(args: MemoryToolArgs): Promise<ToolMemoryResult> {
    const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
    if (approval) {
      const decision = await approval.request({
        kind: 'memory',
        summary: `memory ${Array.isArray(args.operations) ? 'batch' : (args.action ?? 'add')}`,
        args,
        origin: 'foreground',
      })
      if (decision.action === 'staged') {
        return {
          ok: true,
          message: decision.message,
          entries: [],
          chars: 0,
          limit: memory.limitFor(args.target === 'user' ? 'user' : 'memory'),
          pending_id: decision.pendingId ?? '',
        }
      }
    }
    const result = await executeMemoryCore(args)
    return {
      ok: result.ok,
      message: result.message,
      entries: result.entries.map(entry => entry.slice(0, 200)),
      chars: result.chars,
      limit: result.limit,
    }
  }

  async function executeMemoryCore(args: MemoryToolArgs): Promise<ToolMemoryResult> {
    const target = args.target === 'user' ? 'user' : 'memory'
    let result
    if (Array.isArray(args.operations)) {
      result = await memory.applyBatch(target, args.operations as MemoryOperation[])
    } else if (args.action === 'add') {
      result = await memory.add(target, args.facts ?? args.content ?? '')
    } else if (args.action === 'replace') {
      result = await memory.replace(target, args.old_text ?? '', args.facts ?? args.content ?? '')
    } else if (args.action === 'remove') {
      result = await memory.remove(target, args.old_text ?? '')
    } else {
      result = { ok: false, message: 'Use operations, or action add/replace/remove.', entries: [], chars: 0, limit: memory.limitFor(target) }
    }
    if (result.ok) await refreshMemoryContext()
    return result
  }

  ctx.inject(['evolutionApproval'], (approvalCtx) => {
    const approval = (approvalCtx as unknown as { evolutionApproval: ApprovalLike }).evolutionApproval
    const dispose = approval.registerRunner('memory', args => executeMemoryCore(args as MemoryToolArgs))
    ctx.effect(() => dispose, 'dsh-evolution.approval-memory-runner')
  })


  // ── Skill manage tool ──────────────────────────────────────
  if (config.skillManageEnabled && !ctx.tools.get('skill_manage')) {
    ctx.tools.register(defineTool({
      name: 'skill_manage',
      description:
        'Manage the reusable skill library. create/update take full SKILL.md content (YAML frontmatter with name and description, then a body). '
        + 'patch applies old_string -> new_string. delete ARCHIVES to .archive/ (recoverable), never hard-deletes. '
        + 'write_file/remove_file manage support files under references/, templates/, scripts/, or assets/. '
        + 'Protected skills (bundled, hub-installed, pinned) reject mutations. '
        + 'Prefer patching an existing class-level umbrella over creating a narrow new skill.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['create', 'edit', 'update', 'patch', 'delete', 'write_file', 'remove_file', 'list'],
          description: 'Operation to perform.',
        },
        name: { type: 'string', description: 'Skill name (lowercase-hyphenated).' },
        content: { type: 'string', description: 'Full SKILL.md content for create/update.' },
        old_string: { type: 'string', description: 'Text to find for patch.' },
        new_string: { type: 'string', description: 'Replacement text for patch.' },
        replace_all: { type: 'boolean', description: 'For patch: replace every occurrence instead of only the first.' },
        absorbed_into: { type: 'string', description: 'For delete: umbrella skill name that absorbed the content.' },
        file_path: { type: 'string', description: 'Support-file path, e.g. references/notes.md.' },
        file_content: { type: 'string', description: 'Support-file content.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            message: { type: 'string', required: true },
            path: { type: 'string' },
            pending_id: { type: 'string' },
            skills: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  description: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.ok ? 'OK' : 'Error'}: ${value.message}` }],
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const origin = exec.agent?.session.header.origin === 'subagent' ? 'background_review' : 'foreground'
        return gateSkill(args, origin)
      },
    }))
  }

  async function gateSkill(args: SkillToolArgs, origin: 'foreground' | 'background_review'): Promise<ToolSkillResult> {
    const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
    if (approval && args.action !== 'list') {
      const decision = await approval.request({
        kind: 'skill',
        summary: `skill ${args.action ?? '?'} ${args.name ?? ''}`.trim(),
        args,
        origin,
      })
      if (decision.action === 'staged') {
        return { ok: true, message: decision.message, skills: [], pending_id: decision.pendingId ?? '' }
      }
    }
    return executeSkillCore(args, origin)
  }

  async function executeSkillCore(args: SkillToolArgs, origin: 'foreground' | 'background_review'): Promise<ToolSkillResult> {
    const usage = await loadUsage(skills.root, evolutionIo)
    const action = args.action ?? ''
    if (action === 'list') {
      const summaries = await skills.list()
      return { ok: true, message: `Listed ${summaries.length} skills.`, skills: summaries.map(s => ({ name: s.name, description: s.description })) }
    }
    const skillName = (args.name ?? '').trim()
    let result
    if (action === 'create') result = await skills.create(skillName, args.content ?? '', origin)
    else if (action === 'edit' || action === 'update') result = await skills.update(skillName, args.content ?? '')
    else if (action === 'patch') result = await skills.patch(skillName, args.old_string ?? '', args.new_string ?? '', args.file_path ?? '', args.replace_all === true)
    else if (action === 'delete') result = await skills.archive(skillName, args.absorbed_into ?? '')
    else if (action === 'write_file') result = await skills.writeSupportFile(skillName, args.file_path ?? '', args.file_content ?? '')
    else if (action === 'remove_file') result = await skills.removeSupportFile(skillName, args.file_path ?? '')
    else result = { ok: false, message: `Unknown action "${action}".` }

    if (result.ok) {
      if (action === 'create' && origin === 'background_review') markAgentCreated(usage, skillName)
      if (action === 'create' || action === 'edit' || action === 'update' || action === 'patch' || action === 'write_file' || action === 'remove_file') bumpPatch(usage, skillName)
      if (action === 'delete') {
        const record = usage.get(skillName)
        if (record) {
          record.state = 'archived'
          record.archived_at = new Date().toISOString()
        }
      }
      await saveUsage(skills.root, usage, evolutionIo)
    }
    return { ok: result.ok, message: result.message, ...result.path ? { path: result.path } : {}, skills: [] }
  }

  ctx.inject(['evolutionApproval'], (approvalCtx) => {
    const approval = (approvalCtx as unknown as { evolutionApproval: ApprovalLike }).evolutionApproval
    const dispose = approval.registerRunner('skill', args => executeSkillCore(args as SkillToolArgs, 'background_review'))
    ctx.effect(() => dispose, 'dsh-evolution.approval-skill-runner')
  })


  // ── Skill usage telemetry (model-invisible; never invalidates cache) ──
  ctx.on('tools/result', (exec, result) => {
    void recordToolResult(exec, result)
  })

  async function recordToolResult(exec: { name: string; arguments: unknown }, result: { isError: boolean }): Promise<void> {
    if (result.isError) return
    const skillName = extractSkillName(exec)
    if (!skillName) return
    const usage = await loadUsage(skills.root, evolutionIo)
    if (exec.name === 'skill') {
      bumpView(usage, skillName)
      bumpUse(usage, skillName)
    } else if (exec.name === 'skill_manage') {
      bumpPatch(usage, skillName)
    }
    await saveUsage(skills.root, usage, evolutionIo)

  }
  // ── Review cadence state, keyed by live session ─────────────
  const reviewStates = new JsonState<Record<string, ReviewState>>('review-state.json', {})
  const turnStarts = new Map<SessionId, number>()

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      turnStarts.set(session.id, session.seq - 1)
      memory.resetFailures()
      return
    }
    if (event.type !== 'turn/end') return
    void onTurnEnd(session, event)
  })

  async function onTurnEnd(session: Session, event: SessionEvent<'turn/end'>): Promise<void> {
    if (!config.reviewEnabled) return
    // A review/curator child must never schedule its own recursive review.
    if (session.header.origin === 'subagent') return
    const agent = ctx.agents.get(session.id)
    const fromSeq = turnStarts.get(session.id) ?? Math.max(0, session.seq - 1)
    turnStarts.delete(session.id)
    const signal = foldTurn(session, fromSeq)
    const state = reviewStates.get()[session.id] ?? { turnsSinceMemory: 0, turnsSinceSkill: 0, lastTurn: -1 }
    const kind = advanceReview(state, event.data.turn, signal, {
      memoryInterval: config.memoryInterval,
      skillInterval: config.skillInterval,
      substantiveMinToolCalls: 3,
      substantiveMinUserChars: 200,
      substantiveMinAgentChars: 500,
    })
    reviewStates.update((value) => { value[session.id] = state })
    void reviewStates.flush()
    if (!kind) return

    session.append('evolution/review-scheduled', {
      kind,
      toolCalls: signal.toolCalls,
      userChars: signal.userChars,
      assistantChars: signal.assistantChars,
    })

    const started = await startBackgroundReview(agent, session, kind, signal)
    if (!started && agent) {
      injectNudge(agent, kind)
    }
  }

  async function startBackgroundReview(
    agent: Agent | undefined,
    session: Session,
    kind: ReviewKind,
    signal: TurnSignals,
  ): Promise<boolean> {
    if (config.reviewMode === 'inject') return false
    const subagents = ctx.get('subagents') as SubagentServiceLike | undefined
    if (!subagents || !agent) return false
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, 120_000)
    try {
      const run = await subagents.start('spawn', {
        label: 'dsh-evolution-review',
        prompt: [{ type: 'text', text: buildReviewRequest(session, kind, signal) }],
        parent: agent,
        signal: controller.signal,
        maxDepth: 0,
        persona: reviewPrompt(kind),
        toolFilter: { allow: [...config.reviewToolAllow] },
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            memoryOps: { type: 'array', items: { type: 'json' } },
            skillOps: { type: 'array', items: { type: 'json' } },
            summary: { type: 'string' },
          },
        },
      })
      const result = await run.result
      await run.dispose()
      const plan = isStructuredPlan(result.structured) ? result.structured : parsePlanFromText(textOf(result.output))
      const actions = await executePlan(plan)
      if (actions.length > 0) {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: `💾 Self-improvement review: ${actions.join(' · ')}` }],
          source: { kind: 'plugin', plugin: 'dsh-evolution', form: 'notice', summary: 'self-improvement review' },
        }))
      }
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }

  function injectNudge(agent: Agent, kind: ReviewKind): void {
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: reviewPrompt(kind) }],
      source: { kind: 'plugin', plugin: 'dsh-evolution', form: 'notice', summary: 'auto-review' },
    }))
  }

  async function executePlan(plan: StructuredPlan): Promise<string[]> {
    const actions: string[] = []
    for (const op of plan.memoryOps ?? []) {
      if (!Array.isArray(op.evidence) || op.evidence.length === 0) continue
      const target = op.target === 'user' ? 'user' : 'memory'
      const action = op.action ?? 'add'
      let result
      if (action === 'add') result = await memory.add(target, op.facts ?? op.content ?? '')
      else if (action === 'replace') result = await memory.replace(target, op.old_text ?? '', op.facts ?? op.content ?? '')
      else if (action === 'remove') result = await memory.remove(target, op.old_text ?? '')
      else continue
      if (result.ok) {
        await refreshMemoryContext()
        actions.push(`Memory ${action}`)
      }
    }
    for (const op of plan.skillOps ?? []) {
      if (!Array.isArray(op.evidence) || op.evidence.length === 0) continue
      const action = op.action ?? 'patch'
      const skillName = (op.name ?? '').trim()
      if (!skillName) continue
      let result
      if (action === 'create') result = await skills.create(skillName, op.content ?? '', 'background_review')
      else if (action === 'update' || action === 'edit') result = await skills.update(skillName, op.content ?? '')
      else if (action === 'patch') result = await skills.patch(skillName, op.old_string ?? '', op.new_string ?? '', op.file_path ?? '', op.replace_all === true)
      else if (action === 'archive') result = await skills.archive(skillName, op.absorbed_into ?? '')
      else continue
      if (result.ok) actions.push(`Skill ${skillName} ${action}`)
    }
    return actions
  }

  // ── Deterministic curator (persistent interval-gated state) ──
  const curatorState = new JsonState<{
    lastRunAt: number
    runCount: number
    lastSummary: string
    paused: boolean
  }>('curator-state.json', { lastRunAt: 0, runCount: 0, lastSummary: '', paused: false })
  if (curatorState.get().lastRunAt === 0) {
    curatorState.update((state) => {
      state.lastRunAt = Date.now()
      state.lastSummary = 'deferred first run — curator seeded, will run after one interval'
    })
    void curatorState.flush()
  }
  const curatorTimer = setInterval(() => {
    if (!config.curatorEnabled || curatorState.get().paused) return
    if (Date.now() - curatorState.get().lastRunAt < config.curatorIntervalHours * 3_600_000) return
    void runCuratorOnce()
  }, 60 * 60 * 1000)
  curatorTimer.unref()

  async function runCuratorOnce(): Promise<void> {
    const usage = await loadUsage(skills.root, evolutionIo)
    const result = computeLifecycleTransitions(usage, {
      staleAfterDays: config.curatorStaleAfterDays,
      archiveAfterDays: config.curatorArchiveAfterDays,
      pruneBuiltins: true,
    })
    for (const skillName of result.archive) {
      const archived = await skills.archive(skillName, 'Lifecycle: reached archive threshold')
      if (!archived.ok) {
        const record = usage.get(skillName)
        if (record) record.state = 'active'
      }
    }
    await saveUsage(skills.root, usage, evolutionIo)
    curatorState.update((state) => {
      state.lastRunAt = Date.now()
      state.runCount += 1
      state.lastSummary = `stale:${result.markStale.length} archived:${result.archive.length}`
    })
    await curatorState.flush()
  }

  ctx.effect(() => () => {
    clearInterval(curatorTimer)
    void reviewStates.flush()
    void curatorState.flush()
    turnStarts.clear()
  }, 'dsh-evolution.cleanup')
}

function extractSkillName(exec: { name: string; arguments: unknown }): string | null {
  if (exec.name === 'skill') {
    const args = asRecord(exec.arguments)
    const value = args.name
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  if (exec.name === 'skill_manage') {
    const args = asRecord(exec.arguments)
    const value = args.name ?? args.skill_name ?? args.skillName
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function buildReviewRequest(session: Session, kind: ReviewKind, signal: TurnSignals): string {
  const messages: string[] = []
  const start = Math.max(0, session.events.length - 80)
  for (let index = start; index < session.events.length; index += 1) {
    const event = session.events[index]
    if (!event) continue
    if (event.type === 'user/message') {
      const text = event.data.content.map(block => block.type === 'text' ? block.text : '').join(' ').trim()
      if (text) messages.push(`USER: ${text.slice(0, 2000)}`)
    } else if (event.type === 'assistant/message') {
      const text = event.data.message.content.map(block => block.type === 'text' ? block.text : '').join(' ').trim()
      if (text) messages.push(`ASSISTANT: ${text.slice(0, 2000)}`)
    } else if (event.type === 'tool/call') {
      messages.push(`TOOL: ${event.data.name}`)
    }
  }
  const header = [
    `Review kind: ${kind}`,
    `Turn signals: ${signal.toolCalls} tool calls, ${signal.userChars} user chars, ${signal.assistantChars} assistant chars.`,
    'Return ONLY the requested structured JSON plan. Do not call any tool that mutates files, memory, or skills.',
    'Evidence is required for every operation.',
    '',
  ]
  return header.join('\n') + messages.join('\n')
}

function parsePlanFromText(text: string): StructuredPlan {
  try {
    const parsed = JSON.parse(text) as unknown
    return isStructuredPlan(parsed) ? parsed : { summary: text.slice(0, 500) }
  } catch {
    return { summary: text.slice(0, 500) }
  }
}
