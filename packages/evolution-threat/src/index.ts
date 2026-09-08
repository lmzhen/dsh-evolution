/**
 * Write-time threat guard for evolution tools.
 * @module @deepseek-ai/dsh-evolution-threat
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { EVOLUTION_WRITE_TOOLS, PATTERN_OVERLAP, scanContentThreats, scanMemoryThreats, clampedNumber } from '@deepseek-ai/dsh-evolution-core'

export const name = 'evolution-threat'
export const inject = ['tools']

export interface Config {
  enabled?: boolean
  /** Maximum normalized characters scanned per write field. */
  maxScanChars?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  // V6-05 (0.3.35): the legal range is [PATTERN_OVERLAP + 1, ∞) — a window
  // below the overlap floor cannot guarantee full-coverage scanning (see
  // evolution-core PATTERN_OVERLAP), so the schema rejects it at load and the
  // assembly clamp falls back to the default.
  maxScanChars: z.number().min(PATTERN_OVERLAP + 1).default(65_536),
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
 * default (G3.1: 0/negative/NaN/±Infinity → 65_536; V6-05: a value below
 * PATTERN_OVERLAP + 1 is out of the coverage-guarantee domain → default).
 * Exported so the clamp is directly testable; `apply` warns when a
 * user-supplied value was corrected. */
export function resolveMaxScanChars(config: Config): number {
  return clampedNumber(config.maxScanChars ?? 65_536, 65_536, { min: PATTERN_OVERLAP + 1 })
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  if (!(rawConfig.enabled ?? true)) return
  // V6-05 (0.3.35): the clamp floor is PATTERN_OVERLAP+1 (=4097) so the
  // proportional step never leaves a match span uncovered — a 0 would silently
  // disable scanning and NaN/±Infinity (the number schema lets them through)
  // would corrupt the scan window; the schema `.min(PATTERN_OVERLAP + 1)` and
  // this clamp were both raised to the overlap floor in V6-05.
  const maxScanChars = resolveMaxScanChars(rawConfig)
  if (maxScanChars !== (rawConfig.maxScanChars ?? 65_536)) {
    ctx.logger.warn(`evolution-threat: maxScanChars=${String(rawConfig.maxScanChars)} is invalid; falling back to the default 65_536`)
  }
  // V10-12 (P2-8): the deny decision moved from a `tools/pre-execute`
  // waterfall listener to the monotonic `tools.guard()` channel (the same
  // channel evolution-policy uses). The pre-execute waterfall is extensible
  // and any earlier listener may short-circuit it by returning a decision
  // without calling `next()` — which silently skipped the threat scan. A
  // guard runs for every ALLOWED execution (upstream evaluates guards on the
  // allow path of the pre-execute gate) and cannot be force-allowed or
  // bypassed by listener ordering; a short-circuiting DENIAL still denies the
  // call, so both outcomes keep the payload scanned-or-denied.
  // The former listener is REMOVED rather than kept as a logging observer:
  // guards and listeners receive the same arguments, so keeping both would
  // double-scan every write-tool call on the hot path.
  ctx.inject(['tools'], (toolCtx) => {
    const tools = toolCtx.get('tools') as {
      guard(guard: (exec: { name: string; arguments: unknown }) => string | undefined): () => void
    }
    toolCtx.effect(() => tools.guard((exec) => {
      const hit = scanToolArgs(exec.name, exec.arguments, maxScanChars)
      return hit ?? undefined
    }), 'evolution-threat.tools-guard')
  })
}
