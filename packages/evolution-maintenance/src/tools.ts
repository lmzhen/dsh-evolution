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
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SkillLibrary, redactSecrets, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { computeProbe, PROBE_SIGNALS, type ProbeResult } from './probe.ts'
import { buildEnrichment } from './enrichment.ts'
import { snapshotFromLibrary } from './drift-scan.ts'

export const name = 'evolution-maintenance-tools'

export interface Config {
  /** Skill-tree root for probe reads; empty uses skillsRoot(). Align with
   * tool-skill-manage/skill-usage/evolution-skill-catalog/commands rows (A7). */
  skillsRoot?: string | undefined
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const config = rawConfig
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
        description:
          'Read-only deep-dive into maintenance scan signals: library-level group/cluster membership or per-skill detail (line numbers, pointer gaps, narrow shapes, stamp samples). Machine-derived from the same calculators as the facts block — never introduces new evidence ids. Output is JSON detail.',
        parameters: {
          signal: { type: 'string', required: true, enum: PROBE_SIGNALS },
          target: { type: 'string', description: 'Skill name for skill-level signals (required for stamp_density/body_size/dup_heading/overlong_line/pointer_missing/narrow_name/description_chars/quality_low).' },
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
          const library = new SkillLibrary(config.skillsRoot, ioRegistry.provider())
          // 0.3.9: build snapshots through the SAME enrichment the scan uses
          // (descriptions/supportFiles/quality) — previously the probe fed
          // body-only snapshots and answered "description=missing" while the
          // facts block measured real lengths (review finding, 13:38 run).
          const enrichment = await buildEnrichment(ctx, library)
          const snapshots = await snapshotFromLibrary(library, {
            descriptions: enrichment.descriptions,
            supportFiles: enrichment.supportFiles,
            quality: enrichment.quality,
            protected: enrichment.protected,
            catalogInvalid: enrichment.catalogInvalid,
            usageObserved: enrichment.usageObservedValue,
          })
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
