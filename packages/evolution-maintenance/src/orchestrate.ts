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
  DEFAULT_CURATOR_MODEL,
  DEFAULT_HEALTH_THRESHOLDS,
  LOW_QUALITY_THRESHOLD,
  MAINTAIN_OUTPUT_INSTRUCTION,
  MAINTAIN_PROMPT,
  MAX_TIMER_DELAY_MS,
  MIN_STAMP_BODY_CHARS,
  PROMPT_BUNDLE,
  PROMPT_BUNDLE_ID,
  verifyPromptBundle,
  type DriftReport,
  type DriftSkillSnapshot,
} from '@deepseek-ai/dsh-evolution-core'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentChannel } from '@deepseek-ai/dsh-evolution-core'
import { snapshotFromLibrary, type SkillLibraryLike } from './drift-scan.ts'
import { enrichmentSnapshotOptions, type Enrichment } from './enrichment.ts'
import { renderFacts, type StoreFootprint } from './render-facts.ts'
import { reachabilityFootprint, reclamationFootprint, type FootprintIo } from './footprint.ts'
import { validateAndNormalizeMaintainPlan, type MaintainPlanItem, type ValidationResult } from './validate-plan.ts'

/**
 * W5 G3-S4: execution goes through evolution-core's Channel (the 0.2.1 startActivation contract +
 * restricted preset). The former local views of the platform subagent request/result are gone — a
 * structural copy would be the second definition the contract freeze forbids.
 */

export interface MaintainRuntime {
  /** SkillLibrary-like reader for snapshot assembly. */
  library: SkillLibraryLike
  /** W5 G3-S4: the ONE execution path (capability probe, restricted preset, timeout/abort and
   * exactly-one dispose live in the channel; this orchestrator only maps the outcome). */
  channel: SubagentChannel
  /** The spawning agent (0.2.1 `SubagentStartRequest.parent`). */
  parent: Agent
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
  /** V27 M-02: does the configured skill root EXIST? The io seam maps a missing
   * directory to an empty listing, so "the scan found no skills" could not be
   * told apart from "the configured root is not there" (an unexpanded `~`, a
   * typo — INSTALL.md routes users to absolute paths). Optional: without the
   * probe the scan keeps the previous empty-library answer. */
  rootExists?: (() => Promise<boolean>) | undefined
  /** V27 M-02: the root the probe above refers to, for the error message. */
  /** G3/3.3: the runtime io the footprint reading needs. Optional: a caller without it gets UNKNOWN for
   * every registered store instead of an invented zero. */
  io?: FootprintIo | undefined
  skillRoot?: string | undefined
}

export interface MaintainOptions {
  timeoutMs?: number
  /** 0.19.0 (S2): the run id chosen by the run registry, so the registry record,
   * the persisted event and the report file all name ONE run. Absent under the
   * legacy synchronous call sites, which keep generating their own. */
  runId?: string | undefined
  /** E-6 (v18): external cancel signal (session/UI); combined with timeoutMs. */
  signal?: AbortSignal | undefined
  maxDepth?: number
  model?: string
  provider?: string
  toolAllow?: readonly string[]
  redact?: ((text: string) => string) | undefined
  /** T3-02/A30: the measured enrichment, read through {@link enrichmentSnapshotOptions} — one
   * mapping shared with the `--facts` preview and the probe tool. A closure per field was a second
   * account of the same facts and drifted (the probe's copy lost `liveness`). */
  enrichment?: (() => Enrichment) | undefined
}

export interface MaintainOutcome {
  ok: boolean
  error?: string | undefined
  runId?: string | undefined
  verdict?: 'issues' | 'no_issues' | undefined
  text?: string | undefined
  forcedHuman?: string[] | undefined
  /** G1 (0.20.0): the VALIDATED plan entries in render order — the report's machine-readable
   * ledger. `formatPlan` numbers this same array with stable `[n]` ids, and
   * `needsHumanCount` below is derived from it here, so no reader re-derives either. */
  items?: MaintainPlanItem[] | undefined
  /** The validated plan's notes, carried beside `items` so a reader never infers them. */
  notes?: string[] | undefined
  /** How many entries need the operator's confirmation (`needs_human`, gate included). */
  needsHumanCount?: number | undefined
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
  /** G3/3.3: one reading per registered bounded store, produced at this run's reclamation point.
   * Optional so the preview and any older caller keep the exact block they had. */
  footprint?: readonly StoreFootprint[]  ,
): FactsBundle {
  const report = computeDriftSignals(
    snapshots.map(snapshot => ({ ...snapshot, usageObserved })),
  )
  const signalsVersion = DRIFT_SIGNALS_VERSION
  const signature = jointSignature(MAINTAIN_PROMPT, signalsVersion)
  const facts = renderFacts(report, { signalsVersion, signature, redact, footprint })
  return { report, facts, signalsVersion, signature }
}

/** V6-38: a field value carrying its own standalone `Notes:` line is
 * indistinguishable from the plan's section header in the RENDERED text, and a
 * line shaped like a rendered recommendation (`- [kind] …`) reads as a plan
 * entry that the validated plan does not contain. Mark both while leaving the
 * rest of the field untouched. Notes/undo/override are free text and need this
 * exactly as much as finding/recommendation do. */
function sanitizeField(value: string): string {
  return value.split('\n').map((line) => {
    if (line === 'Notes:') return '> Notes: (inside the field above)'
    return /^\s*- \[/.test(line) ? `> (inside the field above) ${line}` : line
  }).join('\n')
}

function formatPlan(validated: ValidationResult, runId: string): string {
  const { plan, forcedHuman } = validated
  const lines: string[] = []
  lines.push(`Maintenance scan ${runId}: verdict=${plan.verdict} (${plan.plan.length} recommendations, ${plan.notes.length} notes)`)
  // V27 M-01: the notes are rendered for EVERY verdict. The validator REQUIRES
  // a note per over-signal when the verdict is `no_issues`
  // (validate-plan completeness gate), so the early return below used to drop
  // exactly the evidence the model had been forced to produce: the operator
  // read "Nothing to do." and never saw why the signals needed no action.
  const noteLines = plan.notes.length === 0
    ? []
    : ['Notes:', ...plan.notes.map(note => `- ${sanitizeField(note)}`)]
  if (plan.verdict === 'no_issues') {
    lines.push('未检测到漂移问题，无需处理。')
    lines.push(...noteLines)
    return lines.join('\n')
  }
  // G1 (0.20.0): an entry's stable [n] id is its 1-based index in `plan.plan` — the SAME
  // array the outcome carries as `items`, so "do 1, 3" maps to entries without parsing.
  // Notes stay unnumbered on purpose: they are not actionable entries.
  for (const [index, item] of plan.plan.entries()) {
    const flags = [
      item.impact,
      `rev=${item.reversibility}`,
      `conf=${item.confidence.toFixed(2)}`,
      item.needs_human ? 'HUMAN' : '',
    ].filter(Boolean)
    lines.push(`- [${index + 1}] [${item.kind}] ${item.names.join(', ')} · rule=${item.rule} · ${flags.join(' ')}`)
    lines.push(`  finding: ${sanitizeField(item.finding)}`)
    lines.push(`  action: ${sanitizeField(item.recommendation)}`)
    if (item.undo_path && item.undo_path !== 'n/a') lines.push(`  undo: ${sanitizeField(item.undo_path)}`)
    if (item.is_override && item.override_reason) lines.push(`  override: ${sanitizeField(item.override_reason)}`)
  }
  if (forcedHuman.length > 0) {
    lines.push(`(quality_low gate: forced needs_human for ${[...new Set(forcedHuman)].join(', ')})`)
  }
  lines.push(...noteLines)
  return lines.join('\n')
}

/** Run one maintenance scan and return display text plus validation metadata. */
export async function runMaintain(runtime: MaintainRuntime, options: MaintainOptions = {}): Promise<MaintainOutcome> {
  try {
    // Template integrity is a hard gate on the maintenance link (011 §7):
    // the bundle digest covers the FULL template; the joint signature adds
    // the signal vocabulary + thresholds agreement.
    if (!verifyPromptBundle(PROMPT_BUNDLE)) {
      return { ok: false, recommendationCount: 0, error: 'dsh-evolution 提示词包完整性检查失败；拒绝运行 maintain' }
    }
    // 0.3.11: usageObserved is threaded straight into the snapshot assembly so
    // the probe (which reads it off the snapshot) and the facts block (which
    // injects it) can never disagree (E-36).
    const enrichment = options.enrichment?.()
    const readFailures: string[] = []
    const snapshots = await snapshotFromLibrary(runtime.library, {
      ...(enrichment === undefined ? {} : enrichmentSnapshotOptions(enrichment)),
      // E-9 (v18): a single unreadable SKILL.md is skipped with a trace.
      // V27 M-02: the trace is also the evidence that separates "empty library"
      // from "unreadable library" below.
      onReadError: (name, error) => {
        readFailures.push(name)
        runtime.logger?.warn(`evolution-maintenance: skipping unreadable skill "${name}": ${error instanceof Error ? error.message : String(error)}`)
      },
    })
    if (snapshots.length === 0) {
      // V27 M-02: "the scan assembled no snapshots" has three causes, and only
      // one of them may be reported as a clean library:
      //   1. the configured root does not exist (the seam lists a missing
      //      directory as empty) — a configuration error, not a verdict;
      //   2. the root exists and every listed entry was unreadable — the tree
      //      was NOT audited, so "no issues" would be a false clean bill;
      //   3. the root exists and lists nothing — genuinely empty, the only case
      //      where "nothing to do" is the truth.
      if (readFailures.length > 0) {
        return {
          ok: false,
          recommendationCount: 0,
          error: `维护扫描无法读取列出的 ${readFailures.length} 个技能（${readFailures.slice(0, 10).join(', ')}${readFailures.length > 10 ? ', …' : ''}），且一个技能都没读到 —— `
            + 'the library was NOT audited; fix the unreadable skills (or their directory names) and run the scan again',
        }
      }
      if (runtime.rootExists && !(await runtime.rootExists())) {
        return {
          ok: false,
          recommendationCount: 0,
          error: `维护扫描发现技能库为空，但配置的技能根目录不存在${runtime.skillRoot ? ` (${runtime.skillRoot})` : ''} —— `
            + 'point the skillsRoot config at a real directory (a literal `~` is not expanded) and run the scan again',
        }
      }
      // Genuinely empty: no facts to review — do not spend a model call.
      return { ok: true, recommendationCount: 0, runId: options.runId ?? randomUUID(), verdict: 'no_issues', text: '维护扫描：技能库为空，无需处理。' }
    }
    // G3/3.3: the footprint is read at THIS run's reclamation point - one line per registered store,
    // UNKNOWN when a store could not be measured. Removing this call removes every store line from the
    // facts block (the visibility criterion 3.3 is proved by).
    // G3/3.4: the footprint carries BOTH halves - the per-store readings and the three reachability
    // readings. Removing either spread removes its lines from the facts block, which is the visibility
    // criterion both items are proved by.
    const footprint = [
      ...await reclamationFootprint(runtime.io),
      ...await reachabilityFootprint(runtime.io, runtime.skillRoot),
    ]
    const { facts, report, signalsVersion, signature } = buildMaintainFacts(
      snapshots,
      enrichment?.usageObservedValue,
      options.redact,
      footprint,
    )
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
    // it warns and silently becomes 1ms. V27 G2.4: the message interpolates
    // MAX_TIMER_DELAY_MS, so the number has ONE definition (constants.ts).
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
      return { ok: false, recommendationCount: 0, error: `maintain：--timeout 必须是以毫秒为单位的正整数，最大 ${MAX_TIMER_DELAY_MS}；收到 ${String(timeoutMs)}` }
    }
    // 0.3.11 (E-55): route off the same policy as the curator
    // (`evolutionPolicy.get().curatorModel`) instead of a hard-coded maintain
    // model — a missing policy service keeps the documented default. The `?.`
    // after `get()` matters (0.3.18): the getter may RESOLVE to undefined when
    // the service is mounted but returns nothing (commands wires a policy
    // accessor that soft-probes), and `?.get().curatorModel` would read a
    // property of undefined.
    // V27 G2.4: the curator model fallback is the same core constant the policy
    // default uses (a bare literal here could contradict the policy).
    const model = options.model ?? runtime.evolutionPolicy?.get()?.curatorModel ?? DEFAULT_CURATOR_MODEL
    const agentOptions: Record<string, string> = { model }
    if (options.provider) agentOptions.provider = options.provider
    // W5 G3-S4: ONE execution path. The template rides in the prompt (0.2.1 has no persona on the
    // request plane); the restricted preset is the tool/authority carrier.
    const outcome = await runtime.channel.run({
      parent: runtime.parent,
      label: 'dsh-evolution-maintain',
      promptText: template + '\n\n' + prompt,
      kind: 'maintainer',
      allow: [...toolAllow],
      // maxDepth is the ABSOLUTE cap of the subagent's own depth (platform resolveChildDepth:
      // childDepth = parentDepth+1). 1 = subagent allowed, nesting denied (2 > 1); 0 = spawn rejected.
      // V8-23⑩ / V9-12 (0.3.49/0.3.51): a NaN/Infinity/negative depth would fold into the platform's
      // own rejection — anything invalid falls back to 1.
      maxDepth: typeof options.maxDepth === 'number' && Number.isFinite(options.maxDepth) && options.maxDepth >= 1 ? options.maxDepth : 1,
      agentOptions,
      timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
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
              // R3 (round-2 audit): undo_path is OPTIONAL here, exactly as
              // validate-plan.ts treats it (E-56: irreversible items may omit
              // it and normalize to 'n/a'). The schema used to require it
              // unconditionally, so a legal no-undo plan was rejected
              // upstream by the generic schema gate before the validator
              // could speak.
              required: ['kind', 'names', 'rule', 'evidence', 'finding', 'recommendation', 'semantic_reasoning', 'impact', 'impact_reason', 'reversibility', 'confidence', 'needs_human', 'is_override'],
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

    // W5 G3-S4: the channel already disposed the activation; map its outcome and return the SAME
    // operator-facing taxonomy the local result view used to produce.
    if (outcome.kind === 'unavailable') {
      return { ok: false, recommendationCount: 0, error: `维护扫描不可用（${outcome.code}）：${outcome.reason}。请在已挂载 agentPresets/subagents 的宿主会话中重试。` }
    }
    if (outcome.kind === 'aborted') {
      // A cancelled run settles as aborted: distinguish it from 'the model produced no plan'.
      return { ok: false, recommendationCount: 0, error: '维护扫描已中止（取消或超时），计划尚未产出 —— 在技能多、库大的场景下，请重试或提高超时（evolution-commands maintainTimeoutMs）。' }
    }
    if (outcome.kind === 'no-structured') {
      return { ok: false, recommendationCount: 0, error: '维护子智能体没有返回结构化计划（模型没有产出结构化计划，或运行在产出前结束）：请重试；若反复出现，请提高 --timeout 或检查模型的输出结构。' }
    }
    const raw = outcome.structured
    const validated = validateAndNormalizeMaintainPlan(raw, report, existingSignalIds(report))
    if (!validated.ok) {
      return {
        ok: false,
        recommendationCount: 0,
        error: `维护计划被校验器拒绝：${validated.errors.slice(0, 5).join('; ')}`,
      }
    }
    const runId = options.runId ?? randomUUID()
    return {
      ok: true,
      runId,
      verdict: validated.plan.verdict,
      forcedHuman: validated.forcedHuman,
      // The ledger: literally the array the rendered [n] ids were numbered from.
      items: validated.plan.plan,
      notes: validated.plan.notes,
      needsHumanCount: validated.plan.plan.filter(item => item.needs_human).length,
      // V10-09 (F-05): the structured plan length IS the recommendation
      // count — consumers read this instead of parsing the rendered text.
      recommendationCount: validated.plan.plan.length,
      text: formatPlan(validated, runId),
    }
  } catch (error) {
    // 0.3.3/0.3.8/0.3.14: translate platform abort results instead of surfacing
    // the raw `Error: This operation was aborted`. Primary evidence is our own
    // signal state (signal.aborted); the narrow literals cover the platform's
    // unstructured parent-cancel leak (plain Error with that exact message).
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
    const message = error instanceof Error ? error.message : String(error)
    const aborted = options.signal?.aborted === true || name === 'AbortError' || message === 'This operation was aborted'
    return {
      ok: false,
      recommendationCount: 0,
      error: aborted
        ? '维护扫描已中止（取消或超时），计划尚未产出 —— 在技能多、库大的场景下，请重试或提高超时（evolution-commands maintainTimeoutMs）。'
        : `Maintenance scan failed: ${message}`,
    }
  }
}
