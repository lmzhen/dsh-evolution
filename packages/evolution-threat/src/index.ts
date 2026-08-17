/**
 * Write-time threat guard for evolution tools.
 * @module @deepseek-ai/dsh-evolution-threat
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { scanContentThreats, scanMemoryThreats } from '@deepseek-ai/dsh-evolution-core'

export const name = 'evolution-threat'
export const inject = ['tools']

export interface Config {
  enabled?: boolean
  /** Maximum normalized characters scanned per write field. */
  maxScanChars?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  maxScanChars: z.number().default(65_536),
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function scanArgs(toolName: string, args: unknown, maxScanChars: number): string | null {
  if (toolName !== 'memory' && toolName !== 'skill_manage') return null
  const record = asRecord(args)
  if (toolName === 'memory') {
    for (const text of [record.facts, record.content]) {
      if (typeof text === 'string') {
        const hit = scanMemoryThreats(text, maxScanChars)
        if (hit) return hit
      }
    }
    if (Array.isArray(record.operations)) {
      for (const op of record.operations) {
        const text = asRecord(op).facts ?? asRecord(op).content
        if (typeof text === 'string') {
          const hit = scanMemoryThreats(text, maxScanChars)
          if (hit) return hit
        }
      }
    }
    return null
  }
  for (const text of [record.content, record.file_content, record.new_string]) {
    if (typeof text === 'string') {
      const hit = scanContentThreats(text, maxScanChars)
      if (hit) return hit
    }
  }
  return null
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  if (!(rawConfig.enabled ?? true)) return
  const maxScanChars = rawConfig.maxScanChars ?? 65_536
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const hit = scanArgs(exec.name, exec.arguments, maxScanChars)
    if (hit) return { kind: 'deny', reason: hit }
    return next()
  })
}
