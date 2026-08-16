/**
 * Write-time threat guard for evolution tools.
 * @module @deepseek-ai/dsh-evolution-threat
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { scanContentThreats, scanMemoryThreats } from '@deepseek-ai/dsh-evolution/src/threats.ts'

export const name = 'evolution-threat'
export const inject = ['tools']

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function scanArgs(toolName: string, args: unknown): string | null {
  if (toolName !== 'memory' && toolName !== 'skill_manage') return null
  const record = asRecord(args)
  if (toolName === 'memory') {
    for (const text of [record.facts, record.content]) {
      if (typeof text === 'string') {
        const hit = scanMemoryThreats(text)
        if (hit) return hit
      }
    }
    if (Array.isArray(record.operations)) {
      for (const op of record.operations) {
        const text = asRecord(op).facts ?? asRecord(op).content
        if (typeof text === 'string') {
          const hit = scanMemoryThreats(text)
          if (hit) return hit
        }
      }
    }
    return null
  }
  for (const text of [record.content, record.file_content, record.new_string]) {
    if (typeof text === 'string') {
      const hit = scanContentThreats(text)
      if (hit) return hit
    }
  }
  return null
}

export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const hit = scanArgs(exec.name, exec.arguments)
    if (hit) return { kind: 'deny', reason: hit }
    return next()
  })
}
