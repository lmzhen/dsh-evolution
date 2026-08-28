/**
 * Model-facing memory tool and runtime-context memory snapshot.
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-memory'
import { resolveOrigins } from '@deepseek-ai/dsh-evolution-core'

export const name = 'tool-memory'

/** Max characters of each echoed memory entry (single source for the Config default and the runtime slice). */
const DEFAULT_ENTRY_PREVIEW_CHARS = 200
export const inject = ['tools', 'systemPrompt', 'memory']

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
  + 'numbers, commit SHAs, or anything stale within a week — use `session_search` '
  + 'to recall past sessions instead. Reusable procedures belong in a skill, not '
  + 'memory.'

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
  + '`session_search`, not memory. Reusable procedures belong in a skill, not '
  + 'memory.'

interface ApprovalLike {
  request(input: { kind: 'memory'; summary: string; args: unknown; origin: 'foreground' | 'background_review'; sessionPolicy?: 'ask' | 'never' }): Promise<{ action: 'allow' | 'staged'; pendingId?: string; message: string }>
  registerRunner(kind: 'memory', runner: (args: unknown) => Promise<{ ok: boolean; message: string }>): () => void
}

interface ApprovalPolicyLike {
  overrideOf(session: unknown): 'ask' | 'never' | undefined
  config: { policy?: 'ask' | 'never' }
}

/**
 * The requesting session's effective approval policy, mirroring
 * `dsh-user-approval` (override ?? configured default). Returns undefined when
 * the approval service is not mounted or no session is available — callers
 * keep their previous behavior.
 */
function effectiveSessionPolicy(ctx: Context, session: unknown): 'ask' | 'never' | undefined {
  const approval = ctx.get('approval') as ApprovalPolicyLike | undefined
  if (!approval || session === undefined) return undefined
  return approval.overrideOf(session) ?? approval.config.policy ?? 'ask'
}

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
  entryPreviewChars: z.number().default(DEFAULT_ENTRY_PREVIEW_CHARS),
})

export async function apply(ctx: Context, rawConfig: Config): Promise<void> {
  if (!rawConfig.memoryEnabled) return
  let snapshotText = await ctx.memory.renderContext()

  ctx.systemPrompt.section({
    name: 'evolution:memory-guidance',
    order: 150,
    text: MEMORY_GUIDANCE,
  })
  ctx.systemPrompt.context({
    name: 'evolution:memory-snapshot',
    order: 150,
    text: () => snapshotText,
  })

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
    if (result.ok) snapshotText = await ctx.memory.renderContext()
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
    async execute(args, exec: { agent?: { session: { header: { origin?: string }; events?: readonly unknown[] } } }) {
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
          ...sessionPolicy !== undefined ? { sessionPolicy } : {},
        })
        if (decision.action === 'staged') {
          return { ok: true, message: decision.message, entries: [], chars: 0, limit: 0, pending_id: decision.pendingId ?? '' }
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
