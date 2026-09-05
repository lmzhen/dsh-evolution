/**
 * Write-time threat guard for evolution tools.
 * @module @deepseek-ai/dsh-evolution-threat
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { EVOLUTION_WRITE_TOOLS, scanContentThreats, scanMemoryThreats, clampedNumber } from '@deepseek-ai/dsh-evolution-core'

export const name = 'evolution-threat'
export const inject = ['tools']

export interface Config {
  enabled?: boolean
  /** Maximum normalized characters scanned per write field. */
  maxScanChars?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  maxScanChars: z.number().min(1).default(65_536),
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Scan one tool invocation for threat-shaped payload text. Exported so the
 * guard contract is testable directly (0.3.17). */
export function scanToolArgs(toolName: string, args: unknown, maxScanChars: number): string | null {
  // 0.3.20 (N-5): the write-tool set is the core single source — the local
  // hardcoded pair drifted into the S3.10 dead-constant trap.
  if (!EVOLUTION_WRITE_TOOLS.includes(toolName as (typeof EVOLUTION_WRITE_TOOLS)[number])) return null
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
        // 0.3.17 (E-28a): `facts ?? content` let a truthy non-string `facts`
        // shadow a string `content` — scan BOTH (union), scanning a value
        // twice is cheap and safe.
        const inner = asRecord(op)
        for (const text of [inner.facts, inner.content]) {
          if (typeof text === 'string') {
            const hit = scanMemoryThreats(text, maxScanChars)
            if (hit) return hit
          }
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

/** Resolve the effective `maxScanChars`, clamping invalid values to the
 * default (G3.1: 0/negative/NaN/±Infinity → 65_536). Exported so the clamp is
 * directly testable; `apply` warns when a user-supplied value was corrected. */
export function resolveMaxScanChars(config: Config): number {
  return clampedNumber(config.maxScanChars ?? 65_536, 65_536, { min: 1 })
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  if (!(rawConfig.enabled ?? true)) return
  // G3.1 (0.3.23): clamp maxScanChars to at least 1. A 0 would silently disable
  // scanning; NaN/±Infinity (the number schema lets them through) would corrupt
  // the scan window. The schema `.min(1)` rejects 0/negative; this clamp is the
  // net that also covers NaN/±Infinity.
  const maxScanChars = resolveMaxScanChars(rawConfig)
  if (maxScanChars !== (rawConfig.maxScanChars ?? 65_536)) {
    ctx.logger.warn(`evolution-threat: maxScanChars=${String(rawConfig.maxScanChars)} is invalid; falling back to the default 65_536`)
  }
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const hit = scanToolArgs(exec.name, exec.arguments, maxScanChars)
    if (hit) return { kind: 'deny', reason: hit }
    return next()
  })
}
