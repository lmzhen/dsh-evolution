/**
 * Model-facing memory tool and runtime-context memory snapshot.
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-memory'

export const name = 'tool-memory'
export const inject = ['tools', 'systemPrompt', 'memory']

interface ApprovalLike {
  request(input: { kind: 'memory'; summary: string; args: unknown; origin: 'foreground' | 'background_review' }): Promise<{ action: 'allow' | 'staged'; pendingId?: string; message: string }>
  registerRunner(kind: 'memory', runner: (args: unknown) => Promise<{ ok: boolean; message: string }>): () => void
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
  entryPreviewChars: z.number().default(200),
})

export async function apply(ctx: Context, rawConfig: Config): Promise<void> {
  if (!rawConfig.memoryEnabled) return
  let snapshotText = await ctx.memory.renderContext()

  ctx.systemPrompt.section({
    name: 'evolution:memory-guidance',
    order: 150,
    text: 'You have durable memory. Save stable user preferences and environment facts with the `memory` tool. Prefer one atomic `operations` batch.',
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
      entries: result.entries.map(entry => entry.slice(0, rawConfig.entryPreviewChars ?? 200)),
      chars: result.chars,
      limit: result.limit,
    }
  }

  ctx.tools.register(defineTool({
    name: 'memory',
    description:
      'Save durable facts to persistent memory. target "user" = who the user is; target "memory" = your notes. '
      + 'Use operations for atomic add/replace/remove. Save proactively; do not save task progress or one-off narratives.',
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
    async execute(args, exec: { agent?: { session: { header: { origin?: string } } } }) {
      const target = args.target === 'user' ? 'user' : 'memory'
      const normalized: MemoryWriteArgs = Array.isArray(args.operations)
        ? { target, operations: args.operations }
        : { target, action: args.action ?? 'add', facts: args.facts ?? args.content, old_text: args.old_text }
      const origin = exec.agent?.session.header.origin === 'subagent' ? 'background_review' : 'foreground'
      const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
      if (approval) {
        const decision = await approval.request({
          kind: 'memory',
          summary: `memory ${target} ${Array.isArray(args.operations) ? `${args.operations.length} ops` : (args.action ?? 'add')}`,
          args: normalized,
          origin,
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
