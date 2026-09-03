/**
 * Maintain orchestration (011 §3/§7): snapshot → drift signals → facts
 * render → subagent (template M + facts) → validate/normalize → display
 * text. Deterministic parts stay pure; the subagent call is the only
 * external dependency (injected, fake-able in tests).
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  AUTHORING_DESCRIPTION_BAR,
  computeDriftSignals,
  DRIFT_MAX_LINE_CHARS,
  DRIFT_SIGNAL_NOUNS,
  DRIFT_SIGNALS_VERSION,
  DEFAULT_HEALTH_THRESHOLDS,
  LOW_QUALITY_THRESHOLD,
  MAINTAIN_PROMPT,
  PROMPT_BUNDLE,
  PROMPT_BUNDLE_ID,
  verifyPromptBundle,
  type DriftReport,
  type DriftSkillSnapshot,
} from '@deepseek-ai/dsh-evolution-core'
import { snapshotFromLibrary, type SkillLibraryLike } from './drift-scan.ts'
import { renderFacts } from './render-facts.ts'
import { validateAndNormalizeMaintainPlan, type ValidationResult } from './validate-plan.ts'

export interface MaintainRuntime {
  /** SkillLibrary-like reader for snapshot assembly. */
  library: SkillLibraryLike
  /** Subagent spawner (platform `subagents` service — minimal shape for injection). */
  subagents: {
    start(kind: string, options: unknown): Promise<{ result: Promise<unknown> }>
  }
  /** Parent agent/session handle passed through to the subagent, when available. */
  parent?: unknown
}

export interface MaintainOptions {
  timeoutMs?: number
  maxDepth?: number
  model?: string
  provider?: string
  toolAllow?: readonly string[]
  redact?: ((text: string) => string) | undefined
  supportFiles?: () => ReadonlyMap<string, readonly string[]>
  descriptions?: () => ReadonlyMap<string, string>
  quality?: () => ReadonlyMap<string, number>
  usageObserved?: () => boolean | undefined
}

export interface MaintainOutcome {
  ok: boolean
  error?: string | undefined
  runId?: string | undefined
  verdict?: 'issues' | 'no_issues' | undefined
  text?: string | undefined
  forcedHuman?: string[] | undefined
}

function existingSignalIds(report: DriftReport): Set<string> {
  const ids = new Set<string>()
  for (const signal of report.library) ids.add(signal.id)
  for (const skill of report.skills) for (const signal of skill.signals) ids.add(signal.id)
  return ids
}

/** Render template-M placeholders from the signal vocabulary (011 single-source rule). */
export function renderMaintainTemplate(
  template: string,
  bundleVersion: string,
  signalsVersion: string,
  signature: string,
): string {
  let out = template
  out = out.replace(/{\s*signal:([a-z_]+)\.threshold\s*}/g, (_, id: string) => thresholdNoun(id))
  out = out.replace(/{\s*signal:([a-z_]+)\s*}/g, (_, id: string) => DRIFT_SIGNAL_NOUNS[id] ?? id)
  out = out.replaceAll('{bundle_version}', bundleVersion)
  out = out.replaceAll('{signals_version}', signalsVersion)
  out = out.replaceAll('{joint_signature}', signature)
  return out
}

function thresholdNoun(id: string): string {
  if (id === 'stamp_density') return `${DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb}/KB`
  if (id === 'description_chars') return `${AUTHORING_DESCRIPTION_BAR}`
  if (id === 'body_size') return `${DEFAULT_HEALTH_THRESHOLDS.softBodyChars}`
  if (id === 'overlong_line') return `${DRIFT_MAX_LINE_CHARS}`
  return `(阈 ${id})`
}

function jointSignature(template: string, signalsVersion: string): string {
  const canonical = JSON.stringify({
    signalsVersion,
    template,
    nouns: DRIFT_SIGNAL_NOUNS,
    thresholds: {
      stampDensityPerKb: DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb,
      minStampBodyChars: 2_000,
      softBodyChars: DEFAULT_HEALTH_THRESHOLDS.softBodyChars,
      descriptionChars: AUTHORING_DESCRIPTION_BAR,
      qualityLow: LOW_QUALITY_THRESHOLD,
      maxLineChars: DRIFT_MAX_LINE_CHARS,
    },
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/** Facts bundle shared by the full scan and the `--facts` 0-token preview. */
export interface FactsBundle {
  report: DriftReport
  facts: string
  signalsVersion: string
  signature: string
}

/**
 * Deterministic half of a maintenance scan: snapshots → drift report →
 * rendered facts block (joint signature + redaction). Shared by `runMaintain`
 * and the `--facts` preview so the preview can never disagree with the scan.
 */
export function buildMaintainFacts(
  snapshots: ReadonlyArray<DriftSkillSnapshot>,
  usageObserved: boolean | undefined,
  redact: ((text: string) => string) | undefined,
): FactsBundle {
  const report = computeDriftSignals(
    snapshots.map(snapshot => ({ ...snapshot, usageObserved })),
  )
  const signalsVersion = DRIFT_SIGNALS_VERSION
  const signature = jointSignature(MAINTAIN_PROMPT, signalsVersion)
  const facts = renderFacts(report, { signalsVersion, signature, redact })
  return { report, facts, signalsVersion, signature }
}

function formatPlan(validated: ValidationResult, runId: string): string {
  const { plan, forcedHuman } = validated
  const lines: string[] = []
  lines.push(`Maintenance scan ${runId}: verdict=${plan.verdict} (${plan.plan.length} recommendations, ${plan.notes.length} notes)`)
  if (plan.verdict === 'no_issues') {
    lines.push('No drift issues detected. Nothing to do.')
    return lines.join('\n')
  }
  for (const item of plan.plan) {
    const flags = [
      item.impact,
      `rev=${item.reversibility}`,
      `conf=${item.confidence.toFixed(2)}`,
      item.needs_human ? 'HUMAN' : '',
    ].filter(Boolean)
    lines.push(`- [${item.kind}] ${item.names.join(', ')} · rule=${item.rule} · ${flags.join(' ')}`)
    lines.push(`  finding: ${item.finding}`)
    lines.push(`  action: ${item.recommendation}`)
    if (item.undo_path && item.undo_path !== 'n/a') lines.push(`  undo: ${item.undo_path}`)
    if (item.is_override && item.override_reason) lines.push(`  override: ${item.override_reason}`)
  }
  if (forcedHuman.length > 0) {
    lines.push(`(quality_low gate: forced needs_human for ${[...new Set(forcedHuman)].join(', ')})`)
  }
  if (plan.notes.length > 0) {
    lines.push('Notes:')
    for (const note of plan.notes) lines.push(`- ${note}`)
  }
  return lines.join('\n')
}

/** Run one maintenance scan and return display text plus validation metadata. */
export async function runMaintain(runtime: MaintainRuntime, options: MaintainOptions = {}): Promise<MaintainOutcome> {
  try {
    // Template integrity is a hard gate on the maintenance link (011 §7):
    // the bundle digest covers the FULL template; the joint signature adds
    // the signal vocabulary + thresholds agreement.
    if (!verifyPromptBundle(PROMPT_BUNDLE)) {
      return { ok: false, error: 'dsh-evolution prompt bundle integrity check failed; refusing to run maintain' }
    }
    const snapshots = await snapshotFromLibrary(runtime.library, {
      supportFiles: options.supportFiles ? options.supportFiles() : undefined,
      descriptions: options.descriptions ? options.descriptions() : undefined,
      quality: options.quality ? options.quality() : undefined,
    })
    if (snapshots.length === 0) {
      // Empty library: no facts to review — do not spend a model call.
      return { ok: true, runId: randomUUID(), verdict: 'no_issues', text: 'Maintenance scan: empty skill library. Nothing to do.' }
    }
    const usageObserved = options.usageObserved ? options.usageObserved() : undefined
    const { facts, report, signalsVersion, signature } = buildMaintainFacts(snapshots, usageObserved, options.redact)
    const template = renderMaintainTemplate(MAINTAIN_PROMPT, PROMPT_BUNDLE_ID, signalsVersion, signature)

    // Persona carries the full template; the prompt carries ONLY the facts
    // block and the output instruction — one copy of the template in the
    // model input (011 v11 P3-4).
    const prompt = `${facts}

按模板契约输出 JSON 维护计划（verdict/plan/notes）；除 skill 工具与维护模板外你无其他工具。`

    const timeoutMs = options.timeoutMs ?? 120_000
    const agentOptions: Record<string, string> = { model: options.model ?? 'deepseek-v4-pro' }
    if (options.provider) agentOptions.provider = options.provider
    const run = await runtime.subagents.start('spawn', {
      label: 'dsh-evolution-maintain',
      prompt: [{ type: 'text', text: prompt }],
      parent: runtime.parent,
      signal: AbortSignal.timeout(timeoutMs),
      maxDepth: options.maxDepth ?? 0,
      agentOptions,
      persona: template,
      toolFilter: { allow: [...(options.toolAllow ?? ['skill', 'maintenance_probe'])] },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdict: { type: 'string' },
          plan: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string' },
                names: { type: 'array', items: { type: 'string' } },
                rule: { type: 'string' },
                evidence: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { signal: { type: 'string' }, value: { type: 'string' } },
                  },
                },
                finding: { type: 'string' },
                recommendation: { type: 'string' },
                semantic_reasoning: { type: 'string' },
                impact: { type: 'string' },
                impact_reason: { type: 'string' },
                reversibility: { type: 'string' },
                undo_path: { type: 'string' },
                confidence: { type: 'number' },
                needs_human: { type: 'boolean' },
                is_override: { type: 'boolean' },
                override_reason: { type: 'string' },
              },
            },
          },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
    })

    const runResult = (await run.result) as { structured?: unknown } | null | undefined
    const raw = runResult?.structured
    if (raw === undefined) {
      // Platform contract: the subagent channel wraps its output as
      // `{ structured }` — a missing structured payload means no usable plan.
      return { ok: false, error: 'Maintain subagent returned no structured plan.' }
    }
    const validated = validateAndNormalizeMaintainPlan(raw, report, existingSignalIds(report))
    if (!validated.ok) {
      return {
        ok: false,
        error: `Maintain plan rejected by validator: ${validated.errors.slice(0, 5).join('; ')}`,
      }
    }
    const runId = randomUUID()
    return {
      ok: true,
      runId,
      verdict: validated.plan.verdict,
      forcedHuman: validated.forcedHuman,
      text: formatPlan(validated, runId),
    }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
