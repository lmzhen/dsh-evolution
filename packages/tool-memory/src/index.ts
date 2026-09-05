/**
 * Model-facing memory tool and runtime-context memory snapshot.
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import { effectiveSessionPolicy, type ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-memory'
import { resolveOrigins } from '@deepseek-ai/dsh-evolution-core'

export const name = 'tool-memory'

/** Max characters of each echoed memory entry (single source for the Config default and the runtime slice). */
const DEFAULT_ENTRY_PREVIEW_CHARS = 200
export const inject = ['tools', 'memory']

/**
 * System-prompt memory guidance, aligned with Hermes `MEMORY_GUIDANCE`.
 * Reached by the model every turn, so it is the place to steer behavior: what
 * to save durably, what not to save, and how to phrase an entry. The tool
 * schema description (`MEMORY_TOOL_DESCRIPTION`) carries the complementary
 * operation-level guidance (add/replace/remove, batch, targets, when).
 */
export const MEMORY_GUIDANCE =
  'You have durable memory across sessions. Save stable user preferences, '
  + 'environment facts, conventions, and tool quirks with the `memory` tool. '
  + 'The most valuable memory is one that stops the user correcting or reminding '
  + 'you again, so user preferences and recurring corrections outrank procedural '
  + 'task details.\n'
  + 'Write entries as declarative facts, not instructions to yourself: '
  + '"User prefers concise responses" (good); "Always respond concisely" (bad). '
  + 'Imperative phrasing is re-read as a directive in later sessions and can '
  + 'override the user\u2019s current request.\n'
  + 'Do NOT save task progress, session outcomes, completed-work logs, PR/issue '
  + 'numbers, commit SHAs, or anything stale within a week — use the session '
  + 'query tool to recall past sessions instead. Reusable procedures belong in '
  + 'a skill, not memory.'

/**
 * Tool-schema description for `memory`, aligned with Hermes `MEMORY_SCHEMA`.
 * Carries the operation-level guidance: how to batch, when to save, the
 * priority order, the target semantics, and what to skip. Reached only when
 * the model is choosing/using the tool, so it complements the always-on
 * `MEMORY_GUIDANCE` system prompt.
 */
export const MEMORY_TOOL_DESCRIPTION =
  'Save durable facts to persistent memory that survive across sessions. '
  + 'Memory is injected into future turns, so keep entries compact and high-signal.\n\n'
  + 'HOW: make all changes in ONE call via an `operations` array (each item '
  + '{action, content?, old_text?}). The batch applies atomically and the char '
  + 'limit is checked on the final result — so one call can remove/replace stale '
  + 'entries to free room AND add new ones. Use bare action/content/old_text '
  + 'only for a single lone change.\n\n'
  + 'WHEN: save proactively when the user states a preference, correction, or '
  + 'personal detail, or you learn a stable fact about their environment, '
  + 'conventions, or workflow. Priority: user preferences & corrections > '
  + 'environment facts > procedures. The best memory stops the user repeating '
  + 'themselves.\n\n'
  + 'TARGETS: "user" = who the user is (name, role, preferences, style). '
  + '"memory" = your notes (environment, conventions, tool quirks, lessons).\n\n'
  + 'SKIP: trivial/obvious info, easily re-discovered facts, task progress, '
  + 'completed-work logs, temporary TODO state. To recall a past session use '
  + 'the session query tool, not memory. Reusable procedures belong in a skill, not '
  + 'memory.'

// 0.3.19 (W1.2): ApprovalLike is imported from evolution-approval (the one
// authoritative consumer shape) instead of this local view. 0.3.23 (G4.8,
// F-341): effectiveSessionPolicy is imported there too — the local copy is gone.

type MemoryAction = 'add' | 'replace' | 'remove'

interface MemoryOperationLike {
  action: MemoryAction
  facts?: string | undefined
  content?: string | undefined
  old_text?: string | undefined
}

interface MemoryWriteArgs {
  target: 'memory' | 'user'
  action?: MemoryAction | undefined
  facts?: string | undefined
  old_text?: string | undefined
  operations?: MemoryOperationLike[] | undefined
}

export interface Config {
  memoryEnabled?: boolean
  /** Maximum characters of each memory entry echoed back in tool results. */
  entryPreviewChars?: number
}

export const Config: z<Config> = z.object({
  memoryEnabled: z.boolean().default(true),
  // 0.3.18 (S4.6, T-13): lower bound 1 — `slice(0, negative)` returned the
  // entry TAIL (semantics inversion) instead of an empty/full preview.
  entryPreviewChars: z.number().min(1).default(DEFAULT_ENTRY_PREVIEW_CHARS),
})

export async function apply(ctx: Context, rawConfig: Config): Promise<void> {
  if (!rawConfig.memoryEnabled) return
  // 0.3.18 (S4.3, E-67): systemPrompt is an OPTIONAL service (soft probe, the
  // M-7 doctrine — align with tool-skill-manage). A host without it still boots
  // and gets the working memory tool; only guidance/snapshot are skipped.
  // The mount-time renderContext() is also failure-tolerant: without a
  // registered memory provider the snapshot degrades to empty (self-corrects
  // at the first successful write through the applied-event listener).
  const systemPrompt = ctx.get('systemPrompt') as {
    section(section: { name: string; order: number; text: string }): () => void
    context(context: { name: string; order: number; text: () => string }): () => void
  } | undefined
  let snapshotText = ''
  try {
    snapshotText = await ctx.memory.renderContext()
  } catch (error) {
    ctx.logger.warn(`tool-memory: memory provider not ready at mount; snapshot starts empty until the first write: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (systemPrompt) {
    ctx.effect(() => systemPrompt.section({
      name: 'evolution:memory-guidance',
      order: 150,
      text: MEMORY_GUIDANCE,
    }), 'tool-memory.memory-guidance')
    ctx.effect(() => systemPrompt.context({
      name: 'evolution:memory-snapshot',
      order: 150,
      text: () => snapshotText,
    }), 'tool-memory.memory-snapshot')
    // P2 fix: the snapshot refresh moved to the write sink (MemoryRegistry
    // emits evolution/memory-applied after ANY successful write). Bypass paths —
    // `/graph edit|delete memory:`, background review direct writes — refresh the
    // model-visible snapshot here, not only the foreground tool's own callback.
    const refreshSnapshot = async (): Promise<void> => {
      try {
        snapshotText = await ctx.memory.renderContext()
      } catch {
        // Snapshot refresh is best-effort; a stale snapshot self-corrects at the
        // next successful refresh (the write itself already landed).
      }
    }
    ctx.effect(() => ctx.on('evolution/memory-applied', () => { void refreshSnapshot() }), 'tool-memory.snapshot-refresh')
  } else {
    ctx.logger.warn('tool-memory: systemPrompt service not mounted; memory guidance and snapshot are not injected (the write tool still works)')
  }

  async function executeCore(normalized: MemoryWriteArgs): Promise<{
    ok: boolean
    message: string
    entries: string[]
    chars: number
    limit: number
    pending_id?: string
  }> {
    const result = normalized.operations
      ? await ctx.memory.applyBatch(normalized.target, normalized.operations)
      : await ctx.memory.applyBatch(normalized.target, [{ action: normalized.action ?? 'add', facts: normalized.facts, old_text: normalized.old_text }])
    // 0.3.18 (S4.2, E-20): the snapshot refresh happens ONLY in the
    // memory-applied listener (single sink — MemoryRegistry emits after every
    // successful write). A render here raced the listener's render and could
    // leave a stale snapshot in the prompt.
    return {
      ok: result.ok,
      message: result.message,
      entries: result.entries.map(entry => entry.slice(0, rawConfig.entryPreviewChars ?? DEFAULT_ENTRY_PREVIEW_CHARS)),
      chars: result.chars,
      limit: result.limit,
    }
  }

  ctx.tools.register(defineTool({
    name: 'memory',
    description: MEMORY_TOOL_DESCRIPTION,
    parameters: {
      target: { type: 'string', enum: ['memory', 'user'], required: true },
      action: { type: 'string', enum: ['add', 'replace', 'remove'] },
      facts: { type: 'string' },
      content: { type: 'string' },
      old_text: { type: 'string' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ['add', 'replace', 'remove'], required: true },
            facts: { type: 'string' },
            content: { type: 'string' },
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
      render: (_args, value) => [{ type: 'text', text: `${value.ok ? 'OK' : 'Error'}: ${value.message} (${value.chars}/${value.limit} chars)` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec: { agent?: { session: { id: string; header: { origin?: string }; events?: readonly unknown[] } } }) {
      // facts and content are the same field under two names; a differing pair
      // is ambiguous input, so fail loud instead of silently dropping one.
      const conflict = (a: { facts?: string; content?: string }): boolean => {
        if (a.facts === undefined || a.content === undefined) return false
        return a.facts !== a.content
      }
      if (Array.isArray(args.operations)) {
        for (const op of args.operations) {
          if (conflict(op)) return { ok: false, message: 'Provide only one of facts or content per operation (same field); different values were given.', entries: [], chars: 0, limit: 0 }
        }
      } else if (conflict(args)) {
        return { ok: false, message: 'Provide only one of facts or content (same field); different values were given.', entries: [], chars: 0, limit: 0 }
      }
      const target = args.target === 'user' ? 'user' : 'memory'
      const normalized: MemoryWriteArgs = Array.isArray(args.operations)
        ? { target, operations: args.operations }
        : { target, action: args.action ?? 'add', facts: args.facts ?? args.content, old_text: args.old_text }
      // Single-source origin table (rc.44 M2-2.3): the approval surface reads
      // the delegated-subagent-as-review-channel mapping from core.
      const origin = resolveOrigins(exec.agent?.session.header.origin).approval
      const sessionPolicy = effectiveSessionPolicy(ctx, exec.agent?.session)
      const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
      if (approval) {
        const decision = await approval.request({
          kind: 'memory',
          summary: `memory ${target} ${Array.isArray(args.operations) ? `${args.operations.length} ops` : (args.action ?? 'add')}`,
          args: normalized,
          origin,
          // 0.3.20 (N-1): the session id rides along so the approval service can
          // DERIVE the platform override ('never' for unattended sessions); the
          // tool previously sent only the self-reported policy, which the
          // mounted platform approval service discards in favour of its own
          // derivation — leaving CI/cron writes stuck in staging.
          ...exec.agent?.session.id ? { sessionId: exec.agent.session.id } : {},
          ...sessionPolicy !== undefined ? { sessionPolicy } : {},
        })
        if (decision.action === 'staged') {
          // 0.3.20 (N-1-followup): no `pending_id ?? ''` — absent stays absent
          // (mirrors the tool-skill-manage E-70 shape).
          return {
            ok: true,
            message: decision.message,
            entries: [],
            chars: 0,
            limit: 0,
            ...decision.pendingId !== undefined ? { pending_id: decision.pendingId } : {},
          }
        }
      }
      return await executeCore(normalized)
    },
  }))

  ctx.inject(['evolutionApproval'], (approvalCtx) => {
    const approval = (approvalCtx as unknown as { evolutionApproval: ApprovalLike }).evolutionApproval
    const dispose = approval.registerRunner('memory', args => executeCore(args as MemoryWriteArgs))
    approvalCtx.effect(() => dispose, 'tool-memory.approval-runner')
  })
}
