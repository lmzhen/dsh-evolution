/**
 * `maintenance_probe` tool (011 Phase 3).
 *
 * Read-only deep-dive: returns single-source machine detail for one signal
 * (library-level group/cluster membership, or per-skill line/pointer/shape
 * evidence). The subagent may use it to sharpen confidence and
 * semantic_reasoning; it must never introduce evidence ids outside the facts
 * block (validated plan-side). No write path exists in this tool.
 * @module @deepseek-ai/dsh-evolution-maintenance-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { assertSkillsRootAliasRetired, clampedNumber, DEFAULT_PROBE_TIMEOUT_MS, MAX_TIMER_DELAY_MS, newSkillLibrary, redactSecrets, resolveRootConfig, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { computeProbe, PROBE_SIGNALS, type ProbeResult } from './probe.ts'
import { buildEnrichment, enrichmentSnapshotOptions } from './enrichment.ts'
import { snapshotFromLibrary } from './drift-scan.ts'

export const name = 'evolution-maintenance-tools'

export interface Config {
  /** Skill-tree root for probe reads; empty uses the default tree. E-7 (v18):
   * canonical key — the same `root` every other family row reads. */
  root?: string | undefined
  /** V27 G2.4 (M-08): RETIRED alias of `root`. Declared so the loader passes it
   * to the load-time gate (which rejects it loudly) instead of dropping it. */
  skillsRoot?: string | undefined
  /** Model-facing budget of one probe call (ms). A hang guard: see
   * `DEFAULT_PROBE_TIMEOUT_MS` for the measurement behind the default and for
   * the conditions that would reopen it. */
  probeTimeoutMs?: number | undefined
}

// F1 (P2-18, v11): family Config-schema convention (same as commands).
export const Config = z.object({
  root: z.string().default(''),
  skillsRoot: z.string().default(''),
  // N3: bounded at both ends like every other numeric family field, and clamped
  // again below for a direct construction that bypasses the schema.
  probeTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_PROBE_TIMEOUT_MS),
})

export function apply(ctx: Context, rawConfig: Config = {}): void {
  // E-7 (v18) → V27 G2.4 (M-08): canonical `root` only; the expired
  // `skillsRoot` alias fails the load instead of being silently ignored.
  assertSkillsRootAliasRetired(rawConfig)
  const rootConfig = resolveRootConfig(rawConfig)
  // The row value, clamped (N3) — the schema already bounds the load-time value.
  const probeTimeoutMs = clampedNumber(rawConfig.probeTimeoutMs, DEFAULT_PROBE_TIMEOUT_MS, { min: 1 })
  ctx.inject(['tools'], (toolCtx) => {
    // Single budget-cast on the injected `tools` service (X-6): the previous
    // `toolCtx as unknown as {...}` double-cast was a gratuitous widening —
    // the service is reachable directly via `get`, so the context object never
    // needs to be re-shaped. Mirrors evolution-policy's tool-injection cast.
    const tools = toolCtx.get('tools') as { register(definition: unknown): () => void }
    // G4.2 (F-210): bind the register disposer to this plugin's fiber so an HMR
    // reload actually removes the tool. Mirrors evolution-policy's tools-guard
    // effect (evolution-policy/index.ts:107).
    toolCtx.effect(() => tools.register(
      defineTool({
        name: 'maintenance_probe',
        // 0.18.1 (S1): the budget the platform's tool-timeout guard reads off the
        // definition, wired from config exactly like `dsh-tool-web`'s
        // `fetchTimeoutMs` → `ToolDefinition.timeoutMs`. A hang guard whose default
        // comes from the measurement (DEFAULT_PROBE_TIMEOUT_MS).
        timeoutMs: probeTimeoutMs,
        description:
          'Read-only deep-dive into maintenance scan signals: library-level group/cluster membership or per-skill detail (line numbers, pointer gaps, narrow shapes, stamp samples). Machine-derived from the same calculators as the facts block — never introduces new evidence ids. Output is JSON detail.',
        parameters: {
          signal: { type: 'string', required: true, enum: PROBE_SIGNALS },
          target: { type: 'string', description: 'Skill name for skill-level signals (required for stamp_density/body_size/dup_heading/overlong_line/pointer_missing/citation_resolution/demand/narrow_name/description_chars/quality_low).' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              signal: { type: 'string' },
              target: { type: 'string' },
              detail: { type: 'array', items: { type: 'string' } },
            },
          },
          render: (_args, value: { detail?: string[] }) => [{ type: 'text', text: (value.detail ?? []).join('\n') }],
        },
        isConcurrencySafe: () => true,
        async execute(args: { signal?: string; target?: string }): Promise<ProbeResult> {
          const signal = args.signal ?? ''
          const target = args.target
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          if (!ioRegistry) return { signal, detail: ['evolution-io registry not mounted'], ...(target ? { target } : {}) }
          const library = newSkillLibrary({ config: rootConfig, io: ioRegistry.provider() })
          // 0.3.9: build snapshots through the SAME enrichment the scan uses
          // (descriptions/supportFiles/quality) — previously the probe fed
          // body-only snapshots and answered "description=missing" while the
          // facts block measured real lengths (review finding, 13:38 run).
          // P3-20 (v14): `buildEnrichment` and `snapshotFromLibrary` each walk
          // the whole tree (list + read per skill), so one probe call is O(2N)
          // reads and a maintain scan repeats it. Deliberately uncached: the
          // probe must observe the CURRENT tree, and the family ships no
          // runId-scoped snapshot store. Revisit only with a measured need
          // (a large library where probe latency becomes visible).
          //
          // 0.18.1 (S1, measured 2026-10-10): the revisit condition above was
          // evaluated. One probe costs 188/220/225 ms on the deployed library
          // (28 skills / 418 KB) and scales linearly at ~5.5 ms per skill (100
          // skills 0.4-0.6 s, 400 skills 1.9-2.5 s); the measured desktop
          // interaction wall is ~305 s, so ~5e4 skills would be needed to reach
          // it. The budget this tool declares is therefore NOT a latency budget —
          // it is a HANG GUARD for the one state the probe cannot report itself:
          // a provider that never answers. See DEFAULT_PROBE_TIMEOUT_MS for the
          // measurement, the ~50x headroom it gives the worst measured case, and
          // the conditions that would reopen both numbers.
          const enrichment = await buildEnrichment(ctx, library)
          // T3-02/A30: through the SHARED mapping — this call used to spell the option
          // list out itself and had silently lost `liveness`, so every probe answered
          // `retire: no-age` while the facts block listed retirement candidates.
          const snapshots = await snapshotFromLibrary(library, enrichmentSnapshotOptions(enrichment))
          // Probe output crosses the session boundary to the maintenance
          // subagent — same redaction policy as the facts block (011 §8).
          const probe = computeProbe(signal, target, snapshots)
          const redacted = redactSecrets(probe.detail.join('\n'))
          return { ...probe, detail: redacted.split('\n') }
        },
      }),
    ), 'evolution-maintenance.tools')
  })
}
