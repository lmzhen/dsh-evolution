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

export interface Config {
  memoryEnabled?: boolean
}

export const Config: z<Config> = z.object({
  memoryEnabled: z.boolean().default(true),
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
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.ok ? 'OK' : 'Error'}: ${value.message} (${value.chars}/${value.limit} chars)` }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const target = args.target === 'user' ? 'user' : 'memory'
      const result = Array.isArray(args.operations)
        ? await ctx.memory.applyBatch(target, args.operations)
        : await ctx.memory.applyBatch(target, [{ action: args.action ?? 'add', facts: args.facts ?? args.content, old_text: args.old_text }])
      if (result.ok) snapshotText = await ctx.memory.renderContext()
      return {
        ok: result.ok,
        message: result.message,
        entries: result.entries.map(entry => entry.slice(0, 200)),
        chars: result.chars,
        limit: result.limit,
      }
    },
  }))
}
