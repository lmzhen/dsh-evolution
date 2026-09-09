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
  MAINTAIN_OUTPUT_INSTRUCTION,
  MAINTAIN_PROMPT,
  MIN_STAMP_BODY_CHARS,
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
  /** Subagent spawner (platform `subagents` service — minimal shape for injection).
   * `dispose` is optional: not every provider exposes it, so the run is only
   * disposed when the platform provides the handle (rc.42 P1-3 parity with review). */
  subagents: {
    start(kind: string, options: unknown): Promise<{ result: Promise<unknown>; dispose?: () => Promise<void> }>
  }
  /** Parent agent/session handle passed through to the subagent, when available. */
  parent?: unknown
  /** Optional logger for dispose-failure traces; when absent the failure is
   * swallowed without surfacing (the orchestrator is a pure function). */
  logger?: { warn(message: string): void } | undefined
  /** Evolution-policy reader for model routing (same source as the curator:
   * `policy.get().curatorModel`). Optional — a missing service falls back to
   * the default model (E-55). `get()` may RESOLVE to undefined (a soft probe
   * can return nothing), hence the type carries it. */
  evolutionPolicy?: { get(): { curatorModel?: string | undefined } | undefined } | undefined
  /** F-02: tools-registry soft probe, wired from the host context
   * (`ctx.get('tools')`) with the platform's `get(name)` accessor shape.
   * Optional — an absent accessor means the tools service is not mounted at
   * all, so no tool beyond `skill` can be assumed registered. */
  tools?: { get(name: string): unknown } | undefined
}

export interface MaintainOptions {
  timeoutMs?: number
  /** E-6 (v18): external cancel signal (session/UI); combined with timeoutMs. */
  signal?: AbortSignal | undefined
  maxDepth?: number
  model?: string
  provider?: string
  toolAllow?: readonly string[]
  redact?: ((text: string) => string) | undefined
  supportFiles?: () => ReadonlyMap<string, readonly string[]>
  descriptions?: () => ReadonlyMap<string, string>
  quality?: () => ReadonlyMap<string, number>
  protected?: () => ReadonlyMap<string, string>
  catalogInvalid?: () => ReadonlyMap<string, boolean>
  usageObserved?: () => boolean | undefined
}

export interface MaintainOutcome {
  ok: boolean
  error?: string | undefined
  runId?: string | undefined
  verdict?: 'issues' | 'no_issues' | undefined
  text?: string | undefined
  forcedHuman?: string[] | undefined
  /** V10-09 (F-05): structured count of recommendations in the VALIDATED plan
   * (plan entries, never notes). Consumers must read this field instead of
   * parsing the rendered `text` — the text is display-only. 0 on every
   * non-success outcome. */
  recommendationCount: number
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
      minStampBodyChars: MIN_STAMP_BODY_CHARS,
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

/** V6-38 (0.3.36): a field value carrying its own standalone `Notes:` line is
 * indistinguishable from the plan's section header in the RENDERED text, which
 * made the rendered plan read as if it ended early. Mark such lines so they
 * can never read as the header. (The former text-based recommendation counter
 * that motivated this marker is gone — V10-09/F-05 moved the count into
 * `MaintainOutcome.recommendationCount` — but the rendered text stays
 * unambiguous for the human reader.) */
function sanitizeField(value: string): string {
  return value.split('\n').map(line => line === 'Notes:' ? '> Notes: (inside the field above)' : line).join('\n')
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
    lines.push(`  finding: ${sanitizeField(item.finding)}`)
    lines.push(`  action: ${sanitizeField(item.recommendation)}`)
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
  // Hoisted so the catch can consult the abort signal (0.3.14 P3-6).
  let abortSignal: AbortSignal | undefined
  try {
    // Template integrity is a hard gate on the maintenance link (011 §7):
    // the bundle digest covers the FULL template; the joint signature adds
    // the signal vocabulary + thresholds agreement.
    if (!verifyPromptBundle(PROMPT_BUNDLE)) {
      return { ok: false, recommendationCount: 0, error: 'dsh-evolution prompt bundle integrity check failed; refusing to run maintain' }
    }
    // 0.3.11: usageObserved is threaded straight into the snapshot assembly so
    // the probe (which reads it off the snapshot) and the facts block (which
    // injects it) can never disagree (E-36).
    const usageObserved = options.usageObserved ? options.usageObserved() : undefined
    const snapshots = await snapshotFromLibrary(runtime.library, {
      supportFiles: options.supportFiles ? options.supportFiles() : undefined,
      descriptions: options.descriptions ? options.descriptions() : undefined,
      quality: options.quality ? options.quality() : undefined,
      protected: options.protected ? options.protected() : undefined,
      catalogInvalid: options.catalogInvalid ? options.catalogInvalid() : undefined,
      usageObserved,
      // E-9 (v18): a single unreadable SKILL.md is skipped with a trace.
      onReadError: (name, error) => {
        runtime.logger?.warn(`evolution-maintenance: skipping unreadable skill "${name}": ${error instanceof Error ? error.message : String(error)}`)
      },
    })
    if (snapshots.length === 0) {
      // Empty library: no facts to review — do not spend a model call.
      return { ok: true, recommendationCount: 0, runId: randomUUID(), verdict: 'no_issues', text: 'Maintenance scan: empty skill library. Nothing to do.' }
    }
    const { facts, report, signalsVersion, signature } = buildMaintainFacts(snapshots, usageObserved, options.redact)
    const template = renderMaintainTemplate(MAINTAIN_PROMPT, PROMPT_BUNDLE_ID, signalsVersion, signature)

    // Persona carries the full template; the prompt carries ONLY the facts
    // block and the output instruction — one copy of the template in the
    // model input (011 v11 P3-4).
    // F-02: soft-probe the tools registry BEFORE the spawn. The
    // `maintenance_probe` entry in the default filter is a cross-package
    // coupling with the host bundle's tools row — a deployment that mounts the
    // command without that row used to fail the spawn outright (the platform
    // rejects a filter naming an unregistered tool). A missing registry entry
    // degrades the filter to `skill` alone and declares the degradation to the
    // model; the facts block remains the complete evidence base (the probe is
    // an optional deep-dive). An explicit `toolAllow` option is an informed
    // override and is passed through untouched.
    const probeRegistered = runtime.tools?.get('maintenance_probe') != null
    const probeDegraded = options.toolAllow === undefined && !probeRegistered
    const toolAllow = options.toolAllow ?? (probeRegistered ? ['skill', 'maintenance_probe'] : ['skill'])
    // F-16: the output instruction is the `maintainOutput` bundle
    // entry (MAINTAIN_OUTPUT_INSTRUCTION) — the digest now covers every
    // model-facing maintenance prompt; it used to be a second, undigested
    // prompt text hardcoded here.
    const prompt = `${facts}${probeDegraded ? '\n\n[tools] maintenance_probe is not registered in this session — the scan degrades to the `skill` tool only; the facts block above remains the complete evidence base. Do not call maintenance_probe.' : ''}

${MAINTAIN_OUTPUT_INSTRUCTION}`

    const timeoutMs = options.timeoutMs ?? 600_000
    // V6-29 (0.3.36): AbortSignal.timeout accepts up to 2^32-1 ms — a larger
    // value throws a synchronous RangeError that only the outer catch would
    // translate (obscuring the cause). Validate the domain up front.
    // P2-10 (v19): the real ceiling is 2^31-1; [2^31, 2^32-1] does not throw,
    // it warns and silently becomes 1ms — the message already said 2147483647.
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 0x7FFFFFFF) {
      return { ok: false, recommendationCount: 0, error: `maintain: --timeout must be a positive integer in ms, at most 2147483647; got ${String(timeoutMs)}` }
    }
    // 0.3.14 (P3-6): the signal object is the authoritative abort evidence —
    // hoisted so the catch can consult `signal.aborted` (our own timeout)
    // instead of matching error text. The narrow literals remain only for the
    // platform's unstructured leak of a parent-cancelled run.
    // E-6 (v18): honor BOTH the scan timeout and the caller's cancel signal.
    const signal = options.signal !== undefined
      ? AbortSignal.any([AbortSignal.timeout(timeoutMs), options.signal])
      : AbortSignal.timeout(timeoutMs)
    abortSignal = signal
    // 0.3.11 (E-55): route off the same policy as the curator
    // (`evolutionPolicy.get().curatorModel`) instead of a hard-coded maintain
    // model — a missing policy service keeps the documented default. The `?.`
    // after `get()` matters (0.3.18): the getter may RESOLVE to undefined when
    // the service is mounted but returns nothing (commands wires a policy
    // accessor that soft-probes), and `?.get().curatorModel` would read a
    // property of undefined.
    const model = options.model ?? runtime.evolutionPolicy?.get()?.curatorModel ?? 'deepseek-v4-pro'
    const agentOptions: Record<string, string> = { model }
    if (options.provider) agentOptions.provider = options.provider
    const run = await runtime.subagents.start('spawn', {
      label: 'dsh-evolution-maintain',
      prompt: [{ type: 'text', text: prompt }],
      parent: runtime.parent,
      signal,
      // maxDepth is the ABSOLUTE cap of the subagent's own depth (platform
      // resolveChildDepth: childDepth = parentDepth+1). 1 = subagent allowed,
      // nesting denied (2 > 1); 0 = spawn itself rejected (0.3.1 defect).
      // V8-23⑩ (0.3.49): guard the exported option — a NaN/Infinity depth would
      // fold into the platform's own rejection; V9-12 (0.3.51) extends the
      // guard below 1 (negative depths pass `Number.isFinite` yet are equally
      // outside the documented domain) — anything invalid falls back to 1.
      maxDepth: typeof options.maxDepth === 'number' && Number.isFinite(options.maxDepth) && options.maxDepth >= 1 ? options.maxDepth : 1,
      agentOptions,
      persona: template,
      toolFilter: { allow: [...toolAllow] },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        // required aligns with validate-plan.ts's validation set (E-56): the
        // two were hand-written copies of the same contract and the schema had
        // no required. override_reason stays optional (case-conditionally
        // required only when is_override, which the validator enforces).
        required: ['verdict', 'plan', 'notes'],
        properties: {
          verdict: { type: 'string' },
          plan: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'names', 'rule', 'evidence', 'finding', 'recommendation', 'semantic_reasoning', 'impact', 'impact_reason', 'reversibility', 'undo_path', 'confidence', 'needs_human', 'is_override'],
              properties: {
                kind: { type: 'string' },
                names: { type: 'array', items: { type: 'string' } },
                rule: { type: 'string' },
                evidence: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['signal', 'value'],
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

    // G4.1 (F-102): dispose the subagent run on every exit path after a
    // successful startup — success, the abort settle, the no-plan settle and
    // the validator-rejected path all route through this finally. Aligns the
    // maintain orchestrator with the review subagent's rc.42 P1-3 treatment.
    try {
      const runResult = (await run.result) as { structured?: unknown; stopReason?: string } | null | undefined
      const raw = runResult?.structured
      if (raw === undefined) {
        // 0.3.8: a CANCELLED run settles by RESOLVING (driver readResult) with
        // structured=undefined and stopReason="aborted" — distinguish that from
        // "the model produced no structured plan" instead of reporting a bare
        // error (evidence: command retry cancels the previous invocation, which
        // surfaced as both "This operation was aborted" and the no-plan text).
        if (runResult?.stopReason === 'aborted') {
          return { ok: false, recommendationCount: 0, error: 'Maintenance scan was aborted (the run was cancelled before the subagent produced a plan) — retry when the session is idle; concurrent re-submission cancels the previous scan.' }
        }
        // Platform contract: the subagent channel wraps its output as
        // `{ structured }` — a missing structured payload means no usable plan.
        return { ok: false, recommendationCount: 0, error: 'Maintain subagent returned no structured plan (the model did not emit the structured plan, or the run ended without one) — retry; if it repeats, raise --timeout or check the model output shape.' }
      }
      const validated = validateAndNormalizeMaintainPlan(raw, report, existingSignalIds(report))
      if (!validated.ok) {
        return {
          ok: false,
          recommendationCount: 0,
          error: `Maintain plan rejected by validator: ${validated.errors.slice(0, 5).join('; ')}`,
        }
      }
      const runId = randomUUID()
      return {
        ok: true,
        runId,
        verdict: validated.plan.verdict,
        forcedHuman: validated.forcedHuman,
        // V10-09 (F-05): the structured plan length IS the recommendation
        // count — consumers read this instead of parsing the rendered text.
        recommendationCount: validated.plan.plan.length,
        text: formatPlan(validated, runId),
      }
    } finally {
      // Dispose failures stay observable without masking the outcome that
      // caused the exit (rc.42 P1-3 parity with the review subagent).
      try {
        await run.dispose?.()
      } catch (disposeError) {
        runtime.logger?.warn(`dsh-evolution-maintenance: subagent dispose failed: ${disposeError instanceof Error ? disposeError.message : String(disposeError)}`)
      }
    }
  } catch (error) {
    // 0.3.3/0.3.8/0.3.14: translate platform abort results instead of surfacing
    // the raw `Error: This operation was aborted`. Primary evidence is our own
    // signal state (signal.aborted); the narrow literals cover the platform's
    // unstructured parent-cancel leak (plain Error with that exact message).
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
    const message = error instanceof Error ? error.message : String(error)
    const aborted = abortSignal?.aborted === true || name === 'AbortError' || message === 'This operation was aborted'
    return {
      ok: false,
      recommendationCount: 0,
      error: aborted
        ? 'Maintenance scan was aborted (cancellation or timeout) before a plan was produced — retry, or raise the timeout (evolution-commands maintainTimeoutMs) on a slow/large library.'
        : `Maintenance scan failed: ${message}`,
    }
  }
}
