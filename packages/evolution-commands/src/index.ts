import { settingsPort } from '@deepseek-ai/dsh-evolution-platform/ports'
/**
 * Human commands for the evolution family: /evolution learn|pending|curator|restore|consolidate|skills refresh.
 * @module @deepseek-ai/dsh-evolution-commands
 */

// platform-declaration anchor: the optional platform seats this file probes (`settings`, `tools`,
// `hmr`, `skillUsage`) are declared by the platform, not by this family: settings by
// `packages/settings/settings/src/index.ts`, tools by `packages/core/tools/src/index.ts` and hmr
// by `vendor/hmr/src/index.ts`. The probes are capability checks — absence degrades a feature and
// `/evolution doctor` reports it.
import type { Context, Volatile } from '@deepseek-ai/cordis'
import { createSubagentChannel, authorityFrom, mutationLockFrom, GOVERNANCE_PROMPT_TEMPLATE, withReviewContext } from '@deepseek-ai/dsh-evolution-core'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { assembleDoctorInputs } from './doctor-view.ts'
import { makeDiagnosticsRoutes } from './diagnostics-route.ts'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-evolution-platform/contract'
import { effectiveSessionPolicy, type ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import { commandsPort, toolsPort } from '@deepseek-ai/dsh-evolution-platform/ports'
import { createUserMessage } from '@deepseek-ai/dsh-evolution-platform/values'
import type { ContextFormed } from '@deepseek-ai/dsh-evolution-platform/contract'
// 0.2.x replaced the shared `{ kind: 'plugin', plugin }` source with a merge-extensible
// map: each producer declares its own kind in its own module, and there is no shared
// catch-all plugin kind (llm/src/message.ts:103-115).
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'evolution-commands': { kind: 'evolution-commands' } & ContextFormed
  }
}
import { appendEvolutionEvent, buildLearnPrompt, reviewPrompt, markReviewChannel, clampedNumber, liveBool, DEFAULT_SKILL_LIMITS, policyStageLimits, type PolicyStageFields, eventsFile, evolutionHome, evolutionRoot, isPresent, isUnknown, probeMtime, MAX_TIMER_DELAY_MS, newRunRegistry, probeText, reportsSweepLockTarget, sweepReports, transactIo, type EvolutionIoLike, type RunRecord, type RunRegistry, type EvolutionErrorId } from '@deepseek-ai/dsh-evolution-core'
import { buildMaintainFacts, runMaintain, snapshotFromLibrary } from '@deepseek-ai/dsh-evolution-maintenance'
import { migrateFromContext, renderNamespaceMigration } from './migration.ts'
import { hostCommandText, hostErrorText, resolveHostLocale } from './host-locale.ts'
import { flagsOf, renderHelpText, renderHint } from './registry.ts'
import { isParseFailure, parseSubcommand } from './parse.ts'
import { HOST_COMMAND_HANDLERS } from './host-commands/handlers.ts'
import { hostCommandDefForCommand } from './host-command-defs.ts'
// G7-3: the atomic writer moved to the core io seam (one implementation); re-exported so this
// module public surface -- Commands.atomicWriteFiles, which the F-211 spec drives -- is unchanged.
import { atomicWriteFiles } from '@deepseek-ai/dsh-evolution-core'
import { assertSkillsRootAliasRetired, resolveRootConfig, newSkillLibrary } from '@deepseek-ai/dsh-evolution-core/skills'
export { atomicWriteFiles }
import { join } from 'node:path'

export const name = 'evolution-commands'

export interface Config {
  /** Skill-tree root for maintain/restructure; empty uses the default tree.
   * E-7 (v18): canonical key — the same `root` every other family row reads,
   * resolved through resolveSkillsRoot() so an empty/whitespace value falls
   * back to the default instead of a CWD-relative root. */
  root?: string | undefined
  /** V27 G2.4 (M-08): RETIRED alias of `root`. The field stays declared so the
   * loader can hand it to the load-time gate (which rejects it loudly) instead
   * of dropping it silently; the plugin never reads it as a root. */
  skillsRoot?: string | undefined
  /** Cooldown window for scan commands (ms) — misclick/rapid-trigger guard;
   * secondary calls inside the window are refused instead of spending another
   * model call. Default 30s (0.3.5). NOTE: the window starts AFTER a run settles
   * (0.19.0/S2: the run registry's newest terminal time) — it does NOT dedupe
   * in-flight runs; that refusal belongs to the registry's in-flight query, not
   * to this window (the old 130s ">= timeout" rationale was a comment bug).
   * Transient (per-process). */
  maintainCooldownMs?: number | undefined
  /** Subagent deadline for one maintenance scan (ms). Default 600s (0.3.10):
   * the real library's full audit (bodies + support files + judgment) needs
   * 4-8 min — the 13:38 successful run used --timeout 600000; the old 120s
   * default deadlined bare runs mid-analysis (14:37 run aborted at 119.94s). */
  maintainTimeoutMs?: number | undefined
  /** G2 (0.20.0): when a scan settles successfully, hand its report to the model
   * automatically (the same pointer+protocol injection `maintain handoff` performs).
   * Default false: the injection wakes a turn, which costs a model call.
   *
   * `.volatile()` (0.21.0, G3): the field carries a USER LAYER, so the loader hands the live
   * reference and the switch is read at every settle — a settings write turns it on or off without
   * a reload. A directly constructed plugin still passes a plain boolean (the schema's default is
   * the loader's face), so the reader accepts both. */
  maintainHandoffOnSettle?: boolean | Volatile<boolean> | undefined
  /** Threat-scan exemption labels for WRITE-path skill mutations (P2-18).
   * Threaded into the SkillLibrary this package constructs for `restructure`
   * (its only write path); the core-side constructor option carries the same
   * field name `threatExemptLabels` (P2-18 core batch — the field name is the
   * linkage contract, keep in sync). Default empty: strict-scan behavior is
   * unchanged; a deployment opts specific labels out explicitly. Read-only
   * paths (maintain / maintain --facts) never threat-scan, so this never
   * widens them. */
  threatExemptLabels?: string[] | undefined
}

// F1 (P2-18, v11): the family Config-schema convention — numeric config gets
// its `.min()` at the loader (the runtime clamp stays as the second layer for
// direct construction/NaN). The interface above stays as the static face.
export const Config = z.object({
  root: z.string().default(''),
  skillsRoot: z.string().default(''),
  maintainCooldownMs: z.number().min(0).default(30_000),
  maintainTimeoutMs: z.number().min(1).default(600_000),
  // `.volatile()` is what gives this field a USER LAYER (the platform's `volatileForm` projection
  // renders only volatile fields), so the registry's E3 row is a knob the operator can reach.
  maintainHandoffOnSettle: z.boolean().default(false).volatile(),
  threatExemptLabels: z.array(z.string()).default([]),
})

/** Enrichment maps shared by the full scan and the `--facts` preview (v12). */
import { buildEnrichment, enrichmentSnapshotOptions, type MaintainPlanItem } from '@deepseek-ai/dsh-evolution-maintenance'

/** One maintenance run's durable record — the body of its report JSON (0.19.0 / S2). */
interface MaintainReportRecord {
  runId: string
  verdict?: 'issues' | 'no_issues' | undefined
  recommendationCount?: number | undefined
  /** G1 (0.20.0): the validated plan entries — the machine-readable ledger behind the
   * rendered `text`. Optional: every report written before 0.20.0 lacks them. */
  items?: MaintainPlanItem[] | undefined
  /** Of `items`, how many need the operator's confirmation (derived by the producer). */
  needsHumanCount?: number | undefined
  /** Skill names the quality_low gate force-marked as needs_human. */
  forcedHuman?: string[] | undefined
  /** The plan's notes, carried alongside `items` so no reader infers them from entries. */
  notes?: string[] | undefined
  failure?: string | undefined
  startedAt: number
  endedAt: number
  text: string
}

/** How one run reads in `maintain status` output. */
function renderRunRecord(record: RunRecord): string {
  const seconds = Math.max(1, Math.round(((record.endedAt ?? Date.now()) - record.startedAt) / 1000))
  const parts = [`${record.id}  ${record.state}  ${seconds}s`]
  if (record.failure !== undefined) parts.push(`— ${record.failure}`)
  if (record.resultRef !== undefined) parts.push(`→ ${record.resultRef}`)
  return parts.join(' ')
}

/** The newest run of one kind this home knows — the default when a subcommand omits its id.
 * The registry view is newest-first and already carries the cross-plane rows. The index is a file
 * a user can hand-edit, so a row with a blank id is skipped rather than answered from. */
const GOVERNANCE_DISPOSE_TIMEOUT_MS = 5_000
const GOVERNANCE_REPORT_TIMEOUT_MS = 10_000

function newestRun(registry: RunRegistry, kind: 'maintain' | 'merge' | 'governance' = 'maintain'): RunRecord | undefined {
  return registry.runs(kind).find(record => record.id.trim() !== '')
}

/** Sentence F, ONE wording for the three id-less forms (design `10` cell 13): an index that could
 * not be read must never answer as "there is no recent run" (G2/0.20.0). */
function unreadableIndex(note: string | undefined): string {
  return `本 home 的运行索引读不出来（${note ?? '原因未知'}）：这不等于「最近没有运行」。`
}

/** The explicit-id twin of {@link unreadableIndex}, worded like `maintain status` so the four
 * readers cannot drift (review P1-1). */
function unreadableForId(id: string, note: string | undefined): string {
  return `运行 ${id} 不在本进程的历史里，且本 home 的运行索引读不出来（${note ?? '原因未知'}）：但这不能证明那次运行没发生过。`
}

/** The reader-facing report path: the `.md` digest beside the run's `.json` result. */
function reportDigestPath(record: { id: string; resultRef?: string | undefined }): string {
  const base = record.resultRef ?? join(evolutionHome(), 'reports', `maintain-${record.id}.json`)
  return base.replace(/\.json$/, '.md')
}

/** Deliver one handoff message through the waking primitive, called ON the receiver
 * (family checklist new-consumer: N13b fails a wake primitive read into a local — the
 * 0.3.73 incident ate review prompts for six days). Falls back to the non-waking
 * `inject`, exactly like `/evolution learn`. @returns true when the receiver woke,
 * false when the message was only queued, `undefined` when neither primitive exists. */
function deliverHandoff(agent: { followup?: unknown; inject?: unknown }, message: unknown): boolean | undefined {
  if (typeof agent.followup === 'function') {
    (agent as unknown as { followup: (value: unknown) => void }).followup(message)
    return true
  }
  if (typeof agent.inject === 'function') {
    (agent as unknown as { inject: (value: unknown) => void }).inject(message)
    return false
  }
  return undefined
}

/** The model-facing handoff message (G2/0.20.0): a POINTER to the report plus the
 * report-only protocol. ONE builder shared by `maintain handoff` and the settle-time
 * automatic handoff, so the two cannot drift. Missing counts are omitted, never guessed. */
function handoffPrompt(input: {
  runId: string
  reportPath: string
  verdict?: 'issues' | 'no_issues' | undefined
  recommendationCount?: number | undefined
  needsHumanCount?: number | undefined
}): string {
  const counts = [
    input.verdict === undefined ? undefined : `verdict=${input.verdict}`,
    input.recommendationCount === undefined ? undefined : `${input.recommendationCount} recommendations`,
    input.needsHumanCount === undefined ? undefined : `${input.needsHumanCount} of them need your user's confirmation`,
  ].filter((part): part is string => part !== undefined)
  const head = `[evolution maintain] The maintenance report for run ${input.runId} is ready: ${input.reportPath}`
  return [
    `${head}${counts.length === 0 ? '' : ` (${counts.join(', ')}; each item has a stable [n] id)`}.`,
    '',
    'This turn is REPORT-ONLY. Read the file, then tell your user what it found and what it proposes — one line',
    'per item: [n] | what would change | which skills | why (the finding) | undo | needs-your-confirmation?',
    'Lead with the items that need confirmation. Do NOT edit, restructure, archive or rename anything in this',
    'turn, and start no other skill work: your user must approve which items to carry out. When they reply by [n]',
    "ids, carry out ONLY the approved items, one at a time, and read each item's undo line before you touch",
    'anything; if an item has no undo line, treat it as irreversible and ask first. Apply every change through',
    'the skill-writing tool (skill_manage) — never edit SKILL.md or its support files with generic file tools:',
    'an out-of-band edit leaves no version in skill history and no audit record.',
  ].join('\n')
}

/**
 * Write one run's result to its ONE home: `<evolutionHome>/reports/maintain-<id>.json`
 * plus the `.md` digest, then sweep that window.
 *
 * A write failure does not fail the run — because the run has no result then, and
 * `maintain report <id>` says exactly that instead of pretending otherwise.
 * @param io - the evolution io seam.
 * @param record - the run's outcome, as persisted.
 * @param warn - warn channel for retention notes.
 * @returns the report path, or `undefined` when nothing could be written.
 */
/**
 * Re-read the run index before answering a command (review P1-1).
 *
 * One DSH_HOME is shared by both planes, so a scan the OTHER process started is
 * only visible after a refresh — without it the in-flight guard, the cooldown and
 * `status <id>` would all describe this process's memory alone. A read FAILURE is
 * not "no runs": the caller decides what to say.
 * @param registry - this row's registry.
 * @returns whether the history could be read, and the note to surface when there is one.
 */
async function syncRuns(registry: RunRegistry): Promise<{ ok: boolean; note?: string }> {
  try {
    return await registry.load()
  } catch (error) {
    return { ok: false, note: `the run index could not be read (${error instanceof Error ? error.message : String(error)})` }
  }
}

async function writeMaintainReport(
  io: EvolutionIoLike,
  record: MaintainReportRecord,
  warn: (message: string) => void,
  evolutionHomePath: string,
  fence?: { run<T>(body: () => Promise<T>): Promise<T> } | undefined,
): Promise<string | undefined> {
  // The home is bound when the RUN starts (passed in, not read here): a run belongs to
  // the home it was started in, and a later home change must not misfile its report.
  const dir = join(evolutionHomePath, 'reports')
  const path = join(dir, `maintain-${record.runId}.json`)
  let written = true
  const body = async (): Promise<void> => {
  try {
    await io.writeText(path, JSON.stringify(record, null, 2))
    await io.writeText(join(dir, `maintain-${record.runId}.md`), record.text.trim() === '' ? `Maintenance run ${record.runId}: ${record.failure ?? 'no plan'}\n` : record.text)
  } catch (error) {
    // The report is the run's ONE result home: a write failure is WARNED about and
    // the run then answers "no result" — it must not disappear silently (P2-3).
    written = false
    warn(`evolution-commands: could not write the report for run ${record.runId} (${error instanceof Error ? error.message : String(error)}) — that run will answer "no result"`)
  }
  // One sweep for every kind (core/reports.ts): the maintenance window reuses the
  // implementation the curator's reports already had, instead of a second copy.
  // The SAME per-home reports lock the curator's sweep holds (v43 FLOW2-1 / N20):
  // "list the directory, then delete beyond the window" is multi-step, and a
  // second host over one home (the desktop and web planes share DSH_HOME) must
  // not interleave with it.
  await transactIo(io, reportsSweepLockTarget(), async () => {
    await sweepReports({ io, dir, buckets: [{ prefix: 'maintain-', keep: 20 }], owner: 'evolution-commands', warn })
    // The lock target itself is never written — the task exists to hold the lock.
    return null
  })
  }
  if (fence !== undefined) await fence.run(body)
  else await body()
  return written ? path : undefined
}

/** Three-state read of a run's result: present, missing, or unreadable (never collapsed). */
async function readRunReport(io: EvolutionIoLike, record: RunRecord): Promise<{ kind: 'present'; text: string; report: Partial<MaintainReportRecord> } | { kind: 'missing' } | { kind: 'unknown'; reason: string }> {
  // A report is read from the home it was WRITTEN in (the registry record was created
  // in this process's home); the fallback path exists for a record without resultRef.
  const path = record.resultRef ?? join(evolutionHome(), 'reports', `maintain-${record.id}.json`)
  const probed = await probeText(io, path)
  if (isUnknown(probed)) return { kind: 'unknown', reason: probed.reason }
  if (!isPresent(probed)) return { kind: 'missing' }
  try {
    const parsed = JSON.parse(probed.value) as Partial<MaintainReportRecord>
    const header = `Maintenance run ${record.id} — ${record.state}${record.failure === undefined ? '' : ` (${record.failure})`}`
    const body = typeof parsed.text === 'string' && parsed.text.trim() !== '' ? parsed.text : renderRunRecord(record)
    // The parsed record rides along so a caller that needs the ledger's counts (handoff)
    // never re-reads the same file — the read stays single-sourced (G2/0.20.0).
    return { kind: 'present', text: `${header}\n${body}`, report: parsed }
  } catch (error) {
    return { kind: 'unknown', reason: `the report is not JSON (${error instanceof Error ? error.message : String(error)})` }
  }
}


export function apply(ctx: Context, rawConfig: Config = {}): void {

  const config = rawConfig
  // E-7 (v18) → V27 G2.4 (M-08): one root key for the whole family. The
  // `skillsRoot` alias expired at 0.3.65; a config that still sets it fails the
  // load here instead of pointing at a root nobody reads.
  assertSkillsRootAliasRetired(rawConfig)
  const skillsRootValue = resolveRootConfig(rawConfig).root
  // 0.19.0 (S2): what is in flight, how a run ended and where its result lives
  // belong to core's run registry — ONE owner instead of three module globals
  // (lastMaintainAt / lastMaintainRunId / maintainInFlightSince), which also lost
  // every answer on a host restart. The registry is created with the io seam below
  // and cancelled with it: work this plugin started must not outlive the plugin.
  // G3 (0.21.0): this row now carries a user-writable field, so suppress the platform's own
  // auto-generated page for it — the family renders the card from the registry instead, and two
  // pages editing one row make a write on the wrong one look ignored. Probed, not assumed: a host
  // without the capability still loads.
  ctx.inject(['settings'], (scope) => {
    const settings = settingsPort(scope)
    if (settings?.configure === undefined) return
    const disposer = settings.configure({ auto: false }, ctx.fiber)
    if (typeof disposer === 'function') scope.effect(() => disposer as () => void, 'evolution-commands: settings presentation')
  })
  let runs: RunRegistry | undefined
  ctx.inject(['evolutionIo'], (ioCtx) => {
    const ioRegistry = ioCtx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
    if (!ioRegistry) return
    const registry = newRunRegistry({
      io: ioRegistry.provider(),
      home: evolutionHome(),
      warn: (message) => { ctx.logger.warn(message) },
      ...((ctx.get('evolutionMutationAuthority') as { readonly homeFence?: { run<T>(body: () => Promise<T>): Promise<T> } } | undefined)?.homeFence === undefined ? {} : { fence: (ctx.get('evolutionMutationAuthority') as { readonly homeFence: { run<T>(body: () => Promise<T>): Promise<T> } }).homeFence }),
    })
    runs = registry
    void registry.load().then((loaded) => {
      // A run the previous process life left behind is reported, not hidden.
      if (!loaded.ok) ctx.logger.warn(`evolution-commands: the run index is not usable — ${loaded.note ?? '原因未知'}`)
      else if (loaded.note !== undefined) ctx.logger.warn(`evolution-commands: ${loaded.note}`)
    }).catch((error: unknown) => {
      ctx.logger.warn(`evolution-commands: could not read the run index (${error instanceof Error ? error.message : String(error)})`)
    })
    ioCtx.effect(() => () => {
      registry.cancelAll()
      runs = undefined
    }, 'evolution-commands.run-registry')
  })
  /** G6/W8: the run-registry snapshot the diagnostics `runs` row reads (one owner: the registry). */
  const doctorRuns = (): { running: number; orphaned: number } => {
    try {
      const records = runs?.runs() ?? []
      const running = records.filter(record => (record as unknown as { state?: string }).state === 'running').length
      const active = runs?.inFlight()
      return { running, orphaned: Math.max(0, running - (active === undefined ? 0 : 1)) }
    } catch {
      return { running: 0, orphaned: 0 }
    }
  }
  ctx.inject(['commands'], (commandCtx) => {
    // V27 G5.2: the platform's own `Context.commands` augmentation + its
    // `CommandDefinition` type are the contract here (previously a local
    // `CommandRuntimeLike { register(definition: unknown) }` and a hand-written
    // `CommandInvocation`, which silenced every upstream shape change: adding a
    // required member to the definition or the invocation failed to compile
    // nowhere in this family). `@deepseek-ai/dsh-commands` is a declared peer,
    // so the types resolve through the same package the platform mounts.
    const commands = commandsPort(commandCtx)
    if (commands === undefined) return
    // M-11 (S6.2, E-29): bind the register disposer to the fiber — an unbound
    // registration survives reload/HMR and registers /evolution twice.
    // evolution-learning-graph is the aligned precedent
    // (commandCtx.effect(() => commands.register(...))).
    // v28 G0.3 (CMD-01): the definition is hoisted to a const so `handler` can
    // delegate to `run` — the wrapper is the ONE net for unexpected throws
    // (a corrupt state file's quarantine, a transient IO error) which used to
    // escape the async handler on every branch except maintain/preset. The
    // upstream dispatcher records such a throw as a bare command/done error
    // and rethrows; this surface's contract is a structured `{kind:'error'}`
    // with next-step guidance instead (doctor.ts already wraps the identical
    // `approval.list()` calls for the same reason).
    // T4-04 (A46): the body is NOT a member of the platform definition. `CommandDefinition`
    // declares `name`/`description`/`recordInput`/`input`/`handler` and no `run`, so the extra key
    // only travelled because the dispatcher ignores unknown keys — a shape a stricter platform
    // (or a definition diff) would flag. The body keeps its own object so the ONE throw wrapper
    // below (v28 G0.3) still nets every branch.
    const commandBody = {
      run: async (invocation: CommandInvocation): Promise<CommandResult> => {
        // V24-12 (v24): collapse internal whitespace for DISPATCH. The grammar
        // matches are single-space exact forms (`pending --detail`, `skills
        // health`, `preset install`, …), so a harmless double-space variant
        // (`pending  --detail`) used to miss every branch, fall through to
        // the help fallback, and return `kind:'success'` with the full help
        // text — indistinguishable from a real result (the exact failure
        // shape F-03 reported and P3-2 fixed for `maintain` only).
        // V25-08 (v25): the collapse applies to MATCHING ONLY — the
        // free-text branches (`learn <request>`, the quoted restructure
        // heading) read their arguments from `rawInputTrimmed` so the user's
        // original spacing reaches the prompt/disk untouched.
        // V27 G5.2: the platform's `CommandInvocation` declares `rawInput` as a
        // non-optional string (as the dispatcher always provides), so the
        // defensive `?? ''` went with the local structural view.
        const rawInputTrimmed = invocation.rawInput.trim()
        const input = rawInputTrimmed.replace(/\s+/g, ' ')
        const ok = (text: string) => ({ kind: 'success' as const, text })
        const err = (text: string) => ({ kind: 'error' as const, text })
        const hostLocale = resolveHostLocale(ctx)
        const hostError = (id: EvolutionErrorId, args: Record<string, string | number> = {}): string => hostErrorText(hostLocale, id, args)
        // G5.3: merge owns its parser and semantics; this surface only owns the
        // /evolution namespace. Forward the RAW input so merge flags survive.
        // 0.3.80 functional check: branches that deliver into the session (or
        // attribute a write to it) dereferenced `invocation.agent` unguarded, so
        // a session-less caller (a script, a headless probe) got a raw TypeError
        // while every sibling branch answered with a documented E-3xx. ONE
        // accessor keeps that answer identical wherever the agent is required.
        const invocationAgent = invocation.agent as unknown as
          | (CommandInvocation['agent'] & { followup?: unknown; inject?: unknown })
          | undefined
        const agentMissing = (need: string): CommandResult | undefined => invocationAgent === undefined
          ? err(hostError('e-305-this-invocation-carries-no', { a1: need }))
          : undefined
        // v43 audit (P1-2): consolidate, the whole-tree `restore` and `skill
        // restore <name>` are destructive and had NO approval seam, while their
        // sibling `restructure` did — in an approval-enabled deployment they
        // wrote straight through the gate the operator configured. They are also
        // NOT replayable through the skill runner (its vocabulary is create /
        // update / patch / delete / write_file / remove_file / restructure /
        // pin / unpin), so there is nothing to stage: the honest answer is to
        // refuse and name the two ways out, never to bypass silently.
        const unreplayableWriteRefusal = (what: string): CommandResult | undefined => {
          if (approval === undefined) return undefined
          const session = invocationAgent?.session
          const sessionPolicy = effectiveSessionPolicy(ctx, session)
          const wouldStage = approval.isEnabled !== false && sessionPolicy !== 'never' && approval.stageForeground !== false
          if (!wouldStage) return undefined
          return err(hostError('e-306-this-deployment-stages-foreground', { a1: what }))
        }
        const approval = (ctx.get('evolutionApproval') as ApprovalLike | undefined)
        // G7.4/C7: the ONE parser answers the shape.
        const command = parseSubcommand(input)
        const maintainSub = (sub: string) => {
          if (isParseFailure(command) || command.name !== 'maintain' || command.positionals[0] !== sub) return null
          return [...command.flags.keys()].every(flag => flagsOf('maintain').includes('--' + flag)) ? command : null
        }
        const def = !isParseFailure(command) ? hostCommandDefForCommand(command) : undefined
        switch (def?.id) {
          case 'pending':
          case 'approve':
          case 'reject':
          case 'release':
          case 'params':
          case 'curator':
          case 'mutations':
          case 'doctor':
          case 'restore':
          case 'skill.restore':
          case 'skill.history':
          case 'skill.undo': {
            if (def === undefined || isParseFailure(command)) break
            const handler = HOST_COMMAND_HANDLERS[def.id]
            if (handler === undefined) break
            const handled = await handler({ input, command, approval, locale: hostLocale, provider: settingsPort(ctx), ctx, runs: doctorRuns, refusal: unreplayableWriteRefusal })
            if (handled !== undefined) return handled
            break
          }
          case 'skill.pin':
          case 'skill.unpin': {
          const pinned = !input.startsWith('skill unpin')
          const name = input.slice(pinned ? 10 : 12).trim()
          if (!name) return err(`用法：/evolution skill ${pinned ? 'pin' : 'unpin'} <name>`)
          const ioRegistry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('未挂载 evolution-io 注册表：无法固定或取消固定技能。')
          // The write-side library is built exactly like restructure's: one construction recipe. The
          // limits ride along because the name guard reads them, so a deployment that raised the
          // name cap can still pin such a skill.
          const library = newSkillLibrary({ authority: authorityFrom({ origin: 'foreground' }),
            config: { root: skillsRootValue },
            io: ioRegistry.provider(),
            ctx,
            limits: {
              ...DEFAULT_SKILL_LIMITS,
              ...policyStageLimits((ctx.get('evolutionPolicy') as { get?(): PolicyStageFields } | undefined)?.get?.()),
            },
          })
          const result = await library.setPinned(name, pinned)
          return result.ok ? ok(result.message) : err(result.message)
          }
          case 'skills.health': {
          const curator = ctx.get('evolutionCurator') as {
            healthView(): Promise<Array<{
              name: string
              verdict: string
              findings?: Array<{ rule: string; severity: string; count: number }>
            }>>
            usageObserved(): Promise<boolean>
          } | undefined
          if (!curator) return err(hostError('e-302-curator-service-not-mounted'))
          const [rows, observed] = await Promise.all([curator.healthView(), curator.usageObserved()])
          // C observation window: before ANY observed read exists, view_count
          // zero is not evidence — say so instead of silently showing a clean
          // (or churn-skewed) verdict.
          const banner = observed ? '' : '使用观测尚未建立 —— 频繁变动（写入幽灵）行已被抑制。'
          // G2: aggregate by RULE ID first (the same rule biting five skills is one problem, not five),
          // then list the rows. Findings are the ONLY text channel now — the free-text `reasons` list
          // was deleted with the engine switch (G2 ③).
          const line = (row: {
            verdict: string
            name: string
            findings?: Array<{ rule: string; severity: string; count: number }>
          }): string => {
            const detail = (row.findings ?? []).map(f => f.rule + ' x' + String(f.count)).join(', ')
            return row.verdict.padEnd(18) + ' ' + row.name + (detail === '' ? '' : ' — ' + detail)
          }
          const tally = new Map<string, { count: number; severity: string }>()
          for (const row of rows) for (const f of row.findings ?? []) {
            const hit = tally.get(f.rule)
            if (hit === undefined) tally.set(f.rule, { count: 1, severity: f.severity })
            else hit.count += 1
          }
          const aggregate = tally.size === 0
            ? []
            : ['Main causes: ' + [...tally.entries()].sort((a, b) => b[1].count - a[1].count).map(([rule, v]) => `${rule} (${v.severity}) x${v.count}`).join(', ')]
          // Never claim health from an empty row list: an empty list means NO DEGRADED ROW WAS
          // REPORTED, which is not the same as every skill being readable and healthy.
          if (rows.length === 0) return ok(['Structure health: no degraded row was reported (this does NOT assert that every skill is readable).', banner].filter(Boolean).join(' '))
          return ok([banner ? `Structure health (${rows.length} degraded): ${banner}` : `Structure health (${rows.length} degraded):`, ...aggregate, ...rows.map(line)].join('\n'))
          }
          case 'review': {
          const requested = ('positionals' in command ? command.positionals[0] : undefined) ?? 'combined'
          if (requested !== 'memory' && requested !== 'skill' && requested !== 'combined') {
            return err('用法：/evolution review [memory|skill|combined]')
          }
          const missing = agentMissing('review')
          if (missing) return missing
          const reviewSession = invocationAgent?.session
          const message = createUserMessage({
            content: [{ type: 'text', text: reviewPrompt(requested, 'inject') }],
            source: { kind: 'evolution-commands', form: 'notice', summary: 'manual evolution review' },
          })
          const agent = invocationAgent as { followup?: unknown; inject?: unknown }
          let woke = false
          if (typeof agent.followup === 'function') {
            (agent as unknown as { followup: (message: unknown) => void }).followup(message)
            woke = true
          } else if (typeof agent.inject === 'function') {
            (agent as unknown as { inject: (message: unknown) => void }).inject(message)
          } else {
            return err(hostError('e-305-the-invocation-agent-exposes', { a1: 'this review request' }))
          }
          if (reviewSession?.id !== undefined) markReviewChannel(String(reviewSession.id))
          return ok(`已注入 ${requested} 复审请求；${woke ? '它会在当前会话立即执行。' : '它会在下一次唤醒时执行。'}`)
          }
          case 'learn': {
          // V25-08 (v25): the free-text request keeps the user's original
          // spacing (only trim) — the whitespace collapse is dispatch-only.
          const request = rawInputTrimmed === 'learn' ? '' : rawInputTrimmed.slice(6).trim()
          // rc.67: command results never enter model history, so an echo can
          // never reach the agent. The prompt is injected as a first-class user
          // message (same pattern as the auto-review inject path).
          // rc.70 F-2: always via createUserMessage — UserMessage requires
          // role:'user' plus the minted id; a bare object only works because
          // the DeepSeek adapter routes undefined-role into the user branch.
          // V27 G0.5 (U-1): delivered through the WAKING channel. `agent.inject`
          // is `send(input, 'next-step', wakeup=false)` — it queues the prompt
          // but never starts a turn, and a slash command does not open one, so
          // `/evolution learn` reported "Follow it now" while nothing happened
          // until the user happened to send another message. `agent.followup`
          // (send 'next-turn', wakeup=true) is the waking primitive; a host that
          // does not expose it degrades to inject — the same followup-first
          // contract evolution-review already ships (V7-03).
          const message = createUserMessage({
            content: [{ type: 'text', text: buildLearnPrompt(request) }],
            source: { kind: 'evolution-commands', form: 'notice', summary: 'learn request' },
          })
          // 0.3.73: call the wake primitive ON the agent. Reading it into a local
          // (the 0.3.68 form) detaches the receiver, and the platform Agent's
          // `followup` is a prototype method that calls `this.send(...)` — every
          // detached call threw, nothing was queued, and the command still
          // reported "Follow it now". Bound arrow stubs in tests cannot show it.
          const missingAgent = agentMissing('learn')
          if (missingAgent) return missingAgent
          const agent = invocationAgent as { followup?: unknown; inject?: unknown }
          // N13b: never select the primitive into a local — call it ON the
          // receiver (a prototype method loses its receiver when detached, 0.3.73).
          let woke = false
          if (typeof agent.followup === 'function') {
            (agent as unknown as { followup: (message: unknown) => void }).followup(message)
            woke = true
          } else if (typeof agent.inject === 'function') {
            (agent as unknown as { inject: (message: unknown) => void }).inject(message)
          } else {
            return err(hostError('e-305-the-invocation-agent-exposes', { a1: 'this learn request' }))
          }
          // rc.68: the learn action joins the event timeline (the loop
          // substrate). Soft probe: without the io registry the log is
          // skipped and the inject is never blocked.
          const registry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
          const eventIo = registry?.provider()
          if (eventIo) {
            const home = evolutionRoot()
            void appendEvolutionEvent(eventIo, eventsFile(home), { type: 'learn', source: 'manual', ...(request ? { request } : {}) }).catch((error: unknown) => {
              ctx.logger.warn(`evolution-commands: failed to record learn event: ${String(error)}`)
            })
          }
          return woke
            ? ok('已向本会话发送学习请求，请现在执行。')
            : ok('学习请求已排入本会话队列：本宿主没有唤醒通道，会在你下一条消息时读取。')
          }
          case 'offload': {
          if (!('positionals' in command)) return err('用法：/evolution offload <skill> [--heading <heading>] [--dry-run]')
          const target = command.positionals[0] ?? ''
          if (target === '') return err('用法：/evolution offload <skill> [--heading <heading>] [--dry-run]')
          const headingFlag = command.flags.get('heading')
          const heading = typeof headingFlag === 'string' && headingFlag.trim() !== '' ? headingFlag.trim() : undefined
          const dryRun = command.flags.has('dry-run')
          if (!dryRun && approval !== undefined && approval.isEnabled !== false) {
            return err('当前部署开启了写入审批：offload 的子智能体是 background origin，写入会被暂存。请先关闭审批，或用 --dry-run 预览。')
          }
          const agent = invocationAgent
          if (agent === undefined) return err(hostError('e-305-this-invocation-carries-no', { a1: 'offload subagent' }))
          const channel = createSubagentChannel(ctx)
          if (channel.state.kind !== 'available') return err(`offload 子智能体不可用：${channel.state.reason}`)
          if (channel.open === undefined) return err('当前部署的 subagent 通道不支持 offload。')
          const allow = dryRun ? ['skill', 'read', 'glob', 'grep'] : ['skill', 'read', 'glob', 'grep', 'skill_manage']
          const prepared = await channel.prepare({ kind: 'governance', allow })
          if (prepared.kind !== 'available') return err(`offload 子智能体不可用：${prepared.reason}`)
          const prompt = GOVERNANCE_PROMPT_TEMPLATE
            .replace('%SKILL%', target)
            .replace('%MODE%', 'offload')
            .replace('%HEADING%', heading ?? 'whole skill')
            .replace('%DRY%', dryRun ? 'yes (no writes)' : 'no')
          const runId = 'offload-' + Date.now().toString(36)
          // Model channel only: the child decides/reads/calls restructure; the
          // platform agent loop owns timeout, and the command's abort signal is
          // linked so a cancelled request also cancels the child. No governance run/status.
          const opened = await withReviewContext({ reviewId: runId, runId, reads: new Set<string>() }, async () => await channel.open!({
            parent: agent as never,
            label: `offload:${target}`,
            promptText: prompt,
            kind: 'governance',
            allow,
            ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
            timeoutMs: 15 * 60 * 1000,
          }))
          if (opened.kind === 'ok') {
            await channel.dispose?.(opened.childId).catch(() => { /* platform cleanup */ })
            return ok(opened.turn.text)
          }
          if (opened.kind === 'unavailable') return err(`offload 子智能体不可用：${opened.reason}`)
          return err('offload 已取消。')
          }
          case 'condense': {
          if (!('positionals' in command)) return err('用法：/evolution condense <skill> [--dry-run]')
          const target = command.positionals[0] ?? ''
          if (target === '') return err('用法：/evolution condense <skill> [--dry-run]')
          const mode = 'condense'
          const heading: string | undefined = undefined
          const dryRun = command.flags.has('dry-run')
          // P1-3: the child writes as a background origin. Any enabled approval
          // queue stages those writes regardless of `stageForeground`, so a run
          // would report success with no historical unit. Refuse honestly;
          // dry-run has no writes and stays available.
          if (!dryRun && approval !== undefined && approval.isEnabled !== false) {
            return err('当前部署开启了写入审批：治理子智能体是 background origin，写入会被暂存，无法保证历史 unit。请先关闭审批，或用 --dry-run 预览。')
          }
          const agent = invocationAgent
          if (agent === undefined) return err(hostError('e-305-this-invocation-carries-no', { a1: 'governance subagent' }))
          // The child is a write-capable subagent; its origin is not the review
          // channel, so the store's pinned guard cannot see it. Refuse the
          // explicitly pinned target before spending a child session on it.
          const ioRegistry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
          if (ioRegistry !== undefined) {
            const preflight = newSkillLibrary({
              authority: authorityFrom({ origin: 'foreground' }),
              config: { root: skillsRootValue },
              io: ioRegistry.provider(),
              ctx,
              threatExemptLabels: config.threatExemptLabels,
              limits: {
                ...DEFAULT_SKILL_LIMITS,
                ...policyStageLimits((ctx.get('evolutionPolicy') as { get?(): PolicyStageFields } | undefined)?.get?.()),
              },
            })
            if (await preflight.isPinned(target)) {
              return err(`技能「${target}」已固定（pinned），治理子智能体不能修改；先 /evolution skill unpin ${target}。`)
            }
          }
          const channel = createSubagentChannel(ctx)
          if (channel.state.kind !== 'available') return err(`治理子智能体不可用：${channel.state.reason}`)
          if (channel.open === undefined) return err('当前部署的 subagent 通道不支持治理运行。')
          if (runs === undefined) return err('未挂载 evolution-io 注册表：无法记录治理运行。')
          const allow = dryRun ? ['skill', 'read', 'glob', 'grep'] : ['skill', 'read', 'glob', 'grep', 'skill_manage']
          // P1-2: `open` resolves only after the child has been started, so a
          // preset/allow failure would otherwise be reported as "started" and
          // only surface in the report. `prepare` is the same preflight kernel
          // uses; answer before promising a run.
          const prepared = await channel.prepare({ kind: 'governance', allow })
          if (prepared.kind !== 'available') return err(`治理子智能体不可用：${prepared.reason}`)
          const active = await runs.findActive('governance')
          if (active !== undefined) return err(`已有治理运行在跑：${active.id}。先等它完成，或用 /evolution maintain status ${active.id} 查看。`)
          let run: Awaited<ReturnType<typeof runs.begin>>
          try {
            run = await runs.begin('governance', { exclusive: true })
          } catch {
            const current = runs.inFlight('governance')
            return err(current === undefined
              ? '已有治理运行在跑。先等它完成，或用 /evolution maintain status 查看。'
              : `已有治理运行在跑：${current.id}。先等它完成，或用 /evolution maintain status ${current.id} 查看。`)
          }
          await runs.stage(run.id, 'author', { done: 0, total: 1 })
          const prompt = GOVERNANCE_PROMPT_TEMPLATE
            .replace('%SKILL%', target)
            .replace('%MODE%', mode)
            .replace('%HEADING%', heading ?? 'whole skill')
            .replace('%DRY%', dryRun ? 'yes (no writes)' : 'no')
          const io = (ctx.get('evolutionIo') as { provider?(name?: string): { writeText(path: string, content: string): Promise<void> } } | undefined)?.provider?.()
          const reportPath = join(evolutionHome(), 'reports', `governance-${run.id}.json`)
          const writeReport = async (state: 'succeeded' | 'failed' | 'cancelled', text: string, failure?: string): Promise<boolean> => {
            if (io === undefined) return false
            try {
              const write = io.writeText(reportPath, JSON.stringify({
                version: 1,
                runId: run.id,
                target,
                mode,
                ...(heading === undefined ? {} : { heading }),
                dryRun,
                state,
                startedAt: run.startedAt,
                finishedAt: new Date().toISOString(),
                text,
                ...(failure === undefined ? {} : { failure }),
              }, null, 2) + '\n').then(() => true).catch(() => false)
              return await Promise.race([
                write,
                new Promise<boolean>(resolve => setTimeout(() => resolve(false), GOVERNANCE_REPORT_TIMEOUT_MS)),
              ])
            } catch (error) {
              ctx.logger.warn(`dsh-evolution-commands: tidy ${target} report write failed: ${error instanceof Error ? error.message : String(error)}`)
              return false
            }
          }
          const open = channel.open.bind(channel)
          void (async () => {
            try {
              const opened = await withReviewContext({ reviewId: run.id, runId: run.id, reads: new Set<string>() }, async () => await open({
                parent: agent as never,
                label: `governance:${target}`,
                promptText: prompt,
                kind: 'governance',
                allow,
                timeoutMs: 15 * 60 * 1000,
                signal: run.signal,
              }))
              if (opened.kind === 'ok') {
                const dispose = channel.dispose?.(opened.childId)
                if (dispose !== undefined) {
                  await Promise.race([
                    dispose.catch(() => { /* best-effort activation cleanup */ }),
                    new Promise<void>(resolve => setTimeout(resolve, GOVERNANCE_DISPOSE_TIMEOUT_MS)),
                  ])
                }
                const wrote = await writeReport('succeeded', opened.turn.text)
                await runs.stage(run.id, 'settle', { done: 1, total: 1 })
                await runs.settle(run.id, { state: 'succeeded', ...(wrote ? { resultRef: reportPath } : {}) })
                return
              }
              const state = opened.kind === 'aborted' ? 'cancelled' : 'failed'
              const failure = opened.kind === 'aborted' ? 'cancelled' : opened.reason
              const wrote = await writeReport(state, '', failure)
              await runs.settle(run.id, { state, ...(wrote ? { resultRef: reportPath } : {}), ...(failure === undefined ? {} : { failure }) })
            } catch (error) {
              const failure = error instanceof Error ? error.message : String(error)
              ctx.logger.warn(`dsh-evolution-commands: tidy ${target} failed: ${failure}`)
              const wrote = await writeReport('failed', '', failure)
              await runs.settle(run.id, { state: 'failed', ...(wrote ? { resultRef: reportPath } : {}), failure })
            }
          })()
          return ok(`已启动治理：${target}（mode=${mode}${dryRun ? '，dry-run' : ''}；run=${run.id}）。完成后在技能历史查看摘要；用 /evolution maintain status ${run.id} 查状态；报告 ${reportPath}。`)
          }
          case 'merge': {
          const merge = ctx.get('evolutionMerge') as undefined | { run(input: string, invocation?: { agent?: unknown }): Promise<{ ok: boolean; text: string }> }
          if (merge === undefined) return err('merge 未挂载：当前安装形态没有 evolution-merge 行（安装形态与命令可用性见 INSTALL.md），或先运行 /evolution doctor。')
          const result = await merge.run(rawInputTrimmed, { agent: invocation.agent })
          return result.ok ? ok(result.text) : err(result.text)
          }
          case 'maintain.status': {
        const maintainStatus = maintainSub('status')
        if (maintainStatus !== null) {
          const registry = runs
          if (!registry) return err('未挂载 evolution-io 注册表：无法查看运行状态。')
          const synced = await syncRuns(registry)
          const wanted = maintainStatus.positionals[1]
          if (wanted !== undefined) {
            // A specific run this process knows is answerable even when the shared
            // index is unreadable — only the claim "this is the whole history" needs it.
            const record = registry.find(wanted)
            if (!record) {
              if (!synced.ok) {
                return err(`运行 ${wanted} 不在本进程的历史里，且本 home 的运行索引读不出来（${synced.note ?? '原因未知'}）：但这不能证明那次运行没发生过。`)
              }
              return err(`本 home 里没有 ${wanted} 这次运行：用 /evolution maintain status 查看最近的几次。`)
            }
            return ok(synced.ok ? renderRunRecord(record) : `${renderRunRecord(record)}\n(运行索引读不出来：${synced.note ?? '原因未知'} — only this process's view is shown)`)
          }
          if (!synced.ok) {
            // P2-1: "the history is unknown" and "there is no run" must not look alike.
            return err(`本 home 的运行历史读不出来（${synced.note ?? '原因未知'}）：这「不是」没有运行。要开始干净的历史，请修好或删除 <evolutionHome>/runs.json。`)
          }
          const all = registry.runs()
          if (all.length === 0) return ok('本 home 还没有维护运行记录：用 /evolution maintain 启动一次。')
          const live = all.filter(record => record.state === 'running')
          const recent = all.filter(record => record.state !== 'running').slice(0, 5)
          return ok([
            live.length === 0 ? 'No maintenance run in flight.' : `In flight:\n${live.map(renderRunRecord).join('\n')}`,
            recent.length === 0 ? '' : `Recent:\n${recent.map(renderRunRecord).join('\n')}`,
          ].filter(part => part !== '').join('\n'))
        }
        // G7.4/C7: the sub-form comes from the ONE parser; the table declares the flags.
            break
          }
          case 'maintain.report': {
        const maintainReport = maintainSub('report')
        if (maintainReport !== null) {
          const registry = runs
          if (!registry) return err('未挂载 evolution-io 注册表：无法查看运行结果。')
          const synced = await syncRuns(registry)
          const wanted = maintainReport.positionals[1]
          // Review P1-1: for the id-less form an unreadable index WINS over the in-memory view —
          // a stale record the process still holds must not answer as if the home were readable
          // (the posture `maintain status` already takes at its list branch).
          if (wanted === undefined && !synced.ok) return err(unreadableIndex(synced.note))
          const record = wanted === undefined ? newestRun(registry) : registry.find(wanted)
          if (!record) {
            // Three states, three sentences: a bad id, an unreadable index, and an empty
            // home must never look alike (G2/0.20.0).
            if (wanted !== undefined) {
              if (!synced.ok) return err(unreadableForId(wanted, synced.note))
              return err(`本 home 里没有 ${wanted} 这次运行：用 /evolution maintain status 查看最近的几次。`)
            }
            return err('本 home 还没有维护运行记录：用 /evolution maintain 启动一次。')
          }
          if (wanted === undefined && record.state === 'running') {
            return err(`最新一次运行 ${record.id} 仍在进行：它结束后才会出报告；用 /evolution maintain status ${record.id} 查看进度。`)
          }
          const ioRegistry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('未挂载 evolution-io 注册表：无法查看运行结果。')
          const probed = await readRunReport(ioRegistry.provider(), record)
          // "no result" and "an unreadable result" must not look alike (the
          // three-state rule the rest of the family follows).
          if (probed.kind === 'missing') {
            return err(`运行 ${record.id}（${record.state}）没有结果：没有写出报告${record.failure === undefined ? '' : `（${record.failure}）`}。`)
          }
          if (probed.kind === 'unknown') return err(`运行 ${record.id} 有报告但读不出来（${probed.reason}）：这「不是」没有结果。`)
          return ok(probed.text)
        }
        // G7.4/C7: the sub-form comes from the ONE parser; the table declares the flags.
            break
          }
          case 'maintain.cancel': {
        const maintainCancel = maintainSub('cancel')
        if (maintainCancel !== null) {
          const registry = runs
          if (!registry) return err('未挂载 evolution-io 注册表：无法取消运行。')
          const synced = await syncRuns(registry)
          const wanted = maintainCancel.positionals[1]
          // Review P1-1: the id-less form answers sentence F when the index could not be read,
          // instead of acting on a stale in-memory view (same posture as `report`/`handoff`).
          if (wanted === undefined && !synced.ok) return err(unreadableIndex(synced.note))
          const record = wanted === undefined ? newestRun(registry) : registry.find(wanted)
          if (!record) {
            if (wanted !== undefined) {
              if (!synced.ok) return err(unreadableForId(wanted, synced.note))
              return err(`本 home 里没有 ${wanted} 这次运行：用 /evolution maintain status 查看最近的几次。`)
            }
            return err('本 home 还没有维护运行记录：用 /evolution maintain 启动一次。')
          }
          // Omitting the id only ever cancels the ONE run this process is running: the
          // registry's owned-only cancel below refuses anything else, and the refusal is
          // worded for the id-less case with a pointer to the explicit form (G2/0.20.0).
          const idlessHint = wanted === undefined ? ' 要取消某次运行请带上 id：/evolution maintain status 会列出它们。' : ''
          // ONE cancel call (review P1-1): a run another process owns cannot be stopped
          // from here, and a terminal one has nothing to cancel — the two answers differ.
          if (!registry.cancel(record.id)) {
            if (record.state === 'running') {
              // Review P2-4: an explicit id cannot cancel a foreign run either, so the id-less
              // hint pointed at a dead end here; the terminal branch below keeps it.
              return err(`运行 ${record.id} 正在共享本 home 的另一个进程里运行：只能在那里取消。`)
            }
            return err(`运行 ${record.id} 已经是 ${record.state}：没有可取消的东西。${idlessHint}`)
          }
          return ok(`维护运行 ${record.id} 已取消：扫描会在下一个检查点停止。用 /evolution maintain status ${record.id} 查看终态。`)
        }
        // G7.4/C7: the sub-form comes from the ONE parser; the table declares the flags.
            break
          }
          case 'maintain.handoff': {
        const maintainHandoff = maintainSub('handoff')
        if (maintainHandoff !== null) {
          const registry = runs
          if (!registry) return err('未挂载 evolution-io 注册表：无法交付报告。')
          const synced = await syncRuns(registry)
          const wanted = maintainHandoff.positionals[1]
          // Review P1-1: never inject from a stale view when the home's index is unreadable.
          if (wanted === undefined && !synced.ok) return err(unreadableIndex(synced.note))
          const record = wanted === undefined ? newestRun(registry) : registry.find(wanted)
          if (!record) {
            if (wanted !== undefined) {
              if (!synced.ok) return err(unreadableForId(wanted, synced.note))
              return err(`本 home 里没有 ${wanted} 这次运行：用 /evolution maintain status 查看最近的几次。`)
            }
            return err('本 home 还没有维护运行记录：用 /evolution maintain 启动一次。')
          }
          if (wanted === undefined && record.state === 'running') {
            return err(`最新一次运行 ${record.id} 仍在进行：它结束后才会出报告；用 /evolution maintain status ${record.id} 查看进度。`)
          }
          const ioRegistry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('未挂载 evolution-io 注册表：无法交付报告。')
          const probed = await readRunReport(ioRegistry.provider(), record)
          if (probed.kind === 'missing') {
            return err(`运行 ${record.id}（${record.state}）没有结果：没有写出报告${record.failure === undefined ? '' : `（${record.failure}）`}。`)
          }
          if (probed.kind === 'unknown') return err(`运行 ${record.id} 有报告但读不出来（${probed.reason}）：这「不是」没有结果。`)
          // Deliver ONLY a pointer plus the report-only protocol: the report file stays
          // the one result home, and the injected text stays small (G2/0.20.0).
          const missingAgent = agentMissing('handoff')
          if (missingAgent) return missingAgent
          const message = createUserMessage({
            content: [{
              type: 'text',
              text: handoffPrompt({
                runId: record.id,
                reportPath: reportDigestPath(record),
                verdict: probed.report.verdict,
                recommendationCount: probed.report.recommendationCount,
                needsHumanCount: probed.report.needsHumanCount,
              }),
            }],
            source: { kind: 'evolution-commands', form: 'notice', summary: 'maintenance report handoff' },
          })
          // N13b: deliverHandoff calls the waking primitive ON the receiver; a host that
          // exposes neither primitive is a documented E-305, never a silent no-op.
          const woke = deliverHandoff(invocationAgent as { followup?: unknown; inject?: unknown }, message)
          if (woke === undefined) return err(hostError('e-305-the-invocation-agent-exposes', { a1: 'this maintenance handoff' }))
          return ok(woke
            ? `已把运行 ${record.id} 交给模型 —— 报告：${reportDigestPath(record)}。它会读取该文件并执行其中的行动项。`
            : `已把运行 ${record.id} 交给模型并排队 —— 本宿主没有唤醒通道，因此会在你下一条消息时被读取。`)
        }
            break
          }
          case 'propose': {
            const curator = ctx.get('evolutionCurator') as { proposeKeeps(): Promise<{ ok: boolean; count: number; message: string }> } | undefined
            if (!curator) return err(hostError('e-302-curator-service-not-mounted'))
            const result = await curator.proposeKeeps()
            return result.ok ? ok(result.message) : err(result.message)
          }
          case 'skills.refresh': {
            ctx.emit('evolution/skills-refresh')
            return ok('已请求重读技能目录：缓存已丢弃，下次查询时重新读取。')
          }
          case 'replay': {
            const replay = ctx.get('evolutionReplay') as { compare(): { report: string } } | undefined
            if (!replay) return err(hostError('e-303-replay-service-not-mounted'))
            return ok(replay.compare().report)
          }
          case 'maintain': {
        if (!isParseFailure(command) && command.name === 'maintain' && command.flags.get('facts') === true && command.positionals.length === 0) {
          // 0-token deterministic preview (011 §12-1 v12): facts block only,
          // no subagent call, no cooldown (the cooldown guards LLM calls).
          // PLAN S5.4 (2026-09-16, audit P2-22): the preview skipped the M-02
          // failure discrimination `runMaintain` runs (evolution-maintenance
          // orchestrate.ts), so a misconfigured or wholly unreadable root
          // rendered a CLEAN facts block and returned success while the full
          // scan reported an error. Collect the same read-failure evidence,
          // run the same rootExists probe (wired exactly like the scan
          // runtime's, including the v30 LIST-02 empty-root rule), and give
          // orchestrate's three-cause conclusion — the preview must never
          // disagree with the scan it previews.
          const ioRegistry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('未挂载 evolution-io 注册表：维护事实不可用。')
          const library = newSkillLibrary({ authority: authorityFrom({ origin: 'foreground' }), config: { root: skillsRootValue }, io: ioRegistry.provider(), ...(mutationLockFrom(ctx) === undefined ? {} : { mutationLock: mutationLockFrom(ctx)! }) })
          const enrichment = await buildEnrichment(ctx, library)
          const readFailures: string[] = []
          const snapshots = await snapshotFromLibrary(library, {
            // T3-02/A30: the SHARED enrichment → options mapping (the preview and the
            // probe tool each used to spell this list out).
            ...enrichmentSnapshotOptions(enrichment),
            // V27 M-02 evidence, same as runMaintain's onReadError.
            onReadError: (name, error) => {
              readFailures.push(name)
              ctx.logger.warn(`evolution-maintenance: skipping unreadable skill "${name}": ${error instanceof Error ? error.message : String(error)}`)
            },
          })
          // orchestrate.ts's three-cause discrimination for an empty snapshot
          // set, inlined (not exported there); messages kept verbatim so both
          // surfaces read identically.
          if (snapshots.length === 0 && readFailures.length > 0) {
            return err(`维护扫描读不出 ${readFailures.length} 个已登记技能（${readFailures.slice(0, 10).join(', ')}${readFailures.length > 10 ? ', …' : ''}），且一个技能都没读到：技能库未被审计。请修好读不出的技能（或它们的目录名）后重新扫描`)
          }
          if (snapshots.length === 0 && skillsRootValue !== ''
            && !(await ioRegistry.provider().exists(skillsRootValue))) {
            return err(`维护扫描发现技能库为空，但配置的技能根目录不存在（${skillsRootValue}）：请把 skillsRoot 指向真实目录（字面量 \`~\` 不会被展开），然后重新扫描`)
          }
          // PLAN-R2 P2-10 (2026-09-16): cause 3 — no read failures and the
          // root probe confirmed the root exists, so the library is genuinely
          // empty. The full scan answers this with plain text and NO facts
          // block (orchestrate.ts: "Genuinely empty: no facts to review — do
          // not spend a model call"), so the preview returns the same verbatim
          // message instead of rendering an empty facts block that would
          // disagree with the scan it previews.
          if (snapshots.length === 0) {
            return ok('维护扫描：技能库为空，无需处理。')
          }
          const { facts } = buildMaintainFacts(snapshots, enrichment.usageObservedValue, undefined)
          return ok(`维护事实（零 token 预览）：\n${facts}`)
        }
        const maintainFlagsDeclared = [...(isParseFailure(command) ? [] : command.flags.keys())]
          .every(flag => flagsOf('maintain').includes('--' + flag))
        if (!isParseFailure(command) && command.name === 'maintain' && command.positionals.length === 0 && maintainFlagsDeclared) {
          // User-command maintenance RUN (design 011; async since 0.19.0 / S2).
          // Deterministic facts + one-shot subagent → a validated plan that is
          // PERSISTED as this run's report; the command only points at it. No
          // writes to the skill tree, no auto execution, fail-closed when a
          // dependency is missing. `--timeout <ms>` overrides the deadline for
          // THIS run — no file edit, no restart.
          const timeoutFlag = command.flags.get('timeout')
          const runTimeoutMs = typeof timeoutFlag === 'string' ? Number(timeoutFlag) : (config.maintainTimeoutMs ?? 600_000)
          // V6-29 (0.3.36): AbortSignal.timeout throws a RangeError above 2^32-1
          // — reject the domain explicitly instead of surfacing the platform
          // error from a `--timeout` typo.
          // P2-10 (v19): the real ceiling is 2^31-1. Node accepts [2^31, 2^32-1]
          // without throwing, warns, and silently sets 1ms — a "legal" value
          // that aborts the scan immediately. V27 G2.4: the messages interpolate
          // MAX_TIMER_DELAY_MS, so the number has ONE definition (constants.ts).
          if (!Number.isSafeInteger(runTimeoutMs) || runTimeoutMs <= 0 || runTimeoutMs > MAX_TIMER_DELAY_MS) {
            // P2-20 (F3, v11): name the ACTUAL source — a bad config value used
            // to be reported as a `--timeout` CLI typo and permanently
            // deadlock maintain (the user had no CLI flag to fix).
            return err(timeoutFlag !== undefined
              ? `--timeout 值不合法：应为不超过 ${MAX_TIMER_DELAY_MS} 的正整数毫秒（例如 /evolution maintain --timeout 600000）。`
              : `maintainTimeoutMs 配置不合法：应为不超过 ${MAX_TIMER_DELAY_MS} 的正整数毫秒。请修正 evolution-commands 行的配置（maintainTimeoutMs）后重试。`)
          }
          const registry = runs
          if (!registry) return err('未挂载 evolution-io 注册表：维护扫描不可用。')
          // Review P1-1: one DSH_HOME, two planes — re-read the index so the in-flight
          // guard and the cooldown cover a scan the OTHER plane started. A read failure
          // is not "no runs": the guard proceeds fail-open and says so out loud.
          const synced = await syncRuns(registry)
          if (!synced.ok) ctx.logger.warn(`evolution-commands: ${synced.note ?? 'run index unreadable'} — the in-flight guard cannot see other processes' runs`)
          else if (synced.note !== undefined) ctx.logger.warn(`evolution-commands: ${synced.note}`)
          const ioRegistry = ctx.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('未挂载 evolution-io 注册表：维护扫描不可用。')
          // W5 G3-S4: the channel owns the capability probe/restricted preset/timeout-dispose; a
          // missing capability surfaces as an explicit unavailable outcome (settled failed with the
          // E-323 reason) instead of a command-level pre-check duplicating the probe.
          const channel = createSubagentChannel(ctx)
          // 0.19.0 (S2): the registry IS the concurrency guard — one owner for
          // "is a scan running" and "when did the last one settle", instead of the
          // three module globals that also lost the answer on a restart.
          const running = registry.inFlight()
          if (running) {
            const elapsed = Math.max(1, Math.round((Date.now() - running.startedAt) / 1000))
            // V10-08 (F-04): a refused scan is NOT a successful scan — the
            // rejection returns kind:'error' so a consumer can distinguish
            // "ran" from "refused" by the result type instead of matching prose.
            return err(`维护运行 ${running.id} 已经在进行中（约 ${elapsed}s 前启动）：现在重交会再开一次扫描。查看状态：/evolution maintain status ${running.id}；停止它：/evolution maintain cancel ${running.id}。`)
          }
          // V8-07 (0.3.47): the cooldown joins the clampedNumber family — a
          // NaN used to disable the cooldown silently (`NaN > 0` is false,
          // exactly the repeated-model-call case this guards) and ±Infinity
          // made every resubmission cooldown-blocked forever.
          const cooldownMs = clampedNumber(config.maintainCooldownMs, 30_000, { min: 0 })
          const lastSettled = registry.lastSettledAt()
          const sinceLast = lastSettled === undefined ? Number.POSITIVE_INFINITY : Date.now() - lastSettled
          if (cooldownMs > 0 && sinceLast < cooldownMs) {
            const remaining = Math.ceil((cooldownMs - sinceLast) / 1000)
            // V10-08 (F-04): same contract as the in-flight refusal above.
            // P3-21 (v14): the newest TERMINAL run is named from the registry, so a
            // failed first scan no longer prints an empty id.
            // The registry tracks ONE kind today (RunKind = 'maintain'), so the kind
            // filter would be a comparison the type system already knows is true;
            // re-add it when a second kind arrives.
            const latest = registry.runs().find(record => record.state !== 'running')
            return err(`维护冷却中（${remaining}s）${latest === undefined ? '' : `，最近一次运行 ${latest.id}`}：现在重跑会再消耗一次模型调用。`)
          }
          // Bind the run's home ONCE, here: the report and the event are written
          // after the scan settles, and they must land in the home this run started
          // in (a DSH_HOME change in between used to misfile them — found by stressing
          // the event-count fixture, where the two events carried different runIds).
          const runHome = evolutionHome()
          const runRoot = evolutionRoot()
          // Captured when the run STARTS, like the home above: the automatic handoff (G2)
          // fires long after this command returned, and it must wake the session that
          // started the scan — not whatever the environment looks like by then.
          const runAgent = invocationAgent
          const handle = await registry.begin('maintain')
          // Detached on purpose. The command answers with a POINTER while the scan
          // keeps working: its lifetime is the handle's, and what stops it is
          // `cancel <id>` or this plugin's dispose — NOT the requesting invocation.
          // Measured: the desktop shell ends a request at ~305 s, which used to
          // abort a scan that was still working (and the family's own 600 s budget
          // could never fire first).
          void (async (): Promise<void> => {
            try {
              const library = newSkillLibrary({ authority: authorityFrom({ origin: 'foreground' }), config: { root: skillsRootValue }, io: ioRegistry.provider(), ...(mutationLockFrom(ctx) === undefined ? {} : { mutationLock: mutationLockFrom(ctx)! }) })
              const enrichment = await buildEnrichment(ctx, library)
              const outcome = await runMaintain(
                {
                  library,
                  channel,
                  parent: invocation.agent,
                  // E-55 (0.3.18): same-source model routing — the maintain subagent
                  // reads evolutionPolicy.get().curatorModel exactly like the curator.
                  // F-02: the tools registry rides along as a soft probe so
                  // the orchestrator can degrade the subagent toolFilter when the
                  // host bundle's maintenance_probe row is not mounted.
                  evolutionPolicy: { get: () => (ctx.get('evolutionPolicy') as { get(): { curatorModel?: string | undefined } } | undefined)?.get() },
                  tools: { get: (name: string) => toolsPort(ctx)?.get(name) },
                  logger: { warn: (message: string) => { ctx.logger.warn(message) } },
                  // V27 M-02: the io seam lists a missing directory as empty, so
                  // the orchestrator needs this probe to tell a misconfigured root
                  // (an unexpanded `~`, a typo) from a genuinely empty library.
                  // v30 LIST-02: the probe runs ONLY when the operator CONFIGURED
                  // a root — `exists('')` is ENOENT, which would report every default
                  // deployment's empty library as "the root does not exist".
                  rootExists: skillsRootValue === '' ? undefined : () => ioRegistry.provider().exists(skillsRootValue),
                  skillRoot: skillsRootValue,
                },
                {
                  timeoutMs: runTimeoutMs,
                  // 0.19.0 (S2): the run's OWN cancellation replaces
                  // `invocation.signal` (E-6/v18) — a request that ends must not
                  // end work that was started to outlive it.
                  signal: handle.signal,
                  // ONE id: the registry record, the persisted event and the
                  // report file all name this run.
                  runId: handle.id,
                  // T3-02/A30: one object instead of a closure per field — the scan,
                  // the preview and the probe read the SAME enrichment.
                  enrichment: () => enrichment,
                },
              )
              const endedAt = Date.now()
              const resultRef = await writeMaintainReport(ioRegistry.provider(), {
                runId: handle.id,
                ...(outcome.ok
                  ? {
                    verdict: outcome.verdict,
                    recommendationCount: outcome.recommendationCount,
                    // G1 (0.20.0): the ledger rides into the report verbatim; the count comes
                    // from the producer so no reader re-derives "which need confirmation".
                    items: outcome.items,
                    notes: outcome.notes,
                    forcedHuman: outcome.forcedHuman,
                    needsHumanCount: outcome.needsHumanCount,
                  }
                  : {}),
                ...(outcome.ok ? {} : { failure: handle.signal.aborted ? 'cancelled: the scan was stopped before it settled' : (outcome.error ?? 'Maintenance scan failed.') }),
                startedAt: handle.startedAt,
                endedAt,
                text: outcome.text ?? '',
              }, (message) => { ctx.logger.warn(message) }, runHome, (ctx.get('evolutionMutationAuthority') as { readonly homeFence?: { run<T>(body: () => Promise<T>): Promise<T> } } | undefined)?.homeFence)
              // W5 G3-S4: a settle that names a resultRef must be readable NOW — otherwise the
              // terminal record points at a file a reader/replay cannot open (write/io race).
              if (resultRef !== undefined) {
                const readable = isPresent(await probeMtime(ioRegistry.provider(), resultRef))
                if (!readable) {
                  await registry.settle(handle.id, {
                    state: 'failed',
                    failure: 'the maintain report file is missing at settle time (write/io race) — the scan result was not persisted.',
                  })
                  return
                }
              }
              const state = outcome.ok ? 'succeeded' : (handle.signal.aborted ? 'cancelled' : 'failed')
              await registry.settle(handle.id, {
                state,
                ...(resultRef === undefined ? {} : { resultRef }),
                ...(outcome.ok ? {} : { failure: handle.signal.aborted ? 'cancelled: the scan was stopped before it settled' : (outcome.error ?? 'Maintenance scan failed.') }),
              })
              if (outcome.ok) {
                void appendEvolutionEvent(ioRegistry.provider(), eventsFile(runRoot), {
                  type: 'maintain',
                  source: 'manual',
                  runId: handle.id,
                  verdict: outcome.verdict,
                  // V10-09 (F-05): the count comes from the structured outcome
                  // field (validated plan length) — the rendered text is display-only.
                  recommendations: outcome.recommendationCount,
                }).catch((error: unknown) => {
                  ctx.logger.warn(`evolution-commands: failed to record maintain event: ${String(error)}`)
                })
                // G2 (0.20.0): the automatic handoff is opt-in (maintainHandoffOnSettle,
                // default false) and reuses the SAME prompt builder as `maintain handoff`
                // so the two can never drift. The receiver was captured when the run
                // STARTED; a delivery failure only warns — the run's terminal state and
                // its report are already committed above.
                if (liveBool(config.maintainHandoffOnSettle) && resultRef !== undefined && runAgent !== undefined) {
                  try {
                    const autoMessage = createUserMessage({
                      content: [{
                        type: 'text',
                        text: handoffPrompt({
                          runId: handle.id,
                          reportPath: reportDigestPath({ id: handle.id, resultRef }),
                          verdict: outcome.verdict,
                          recommendationCount: outcome.recommendationCount,
                          needsHumanCount: outcome.needsHumanCount,
                        }),
                      }],
                      source: { kind: 'evolution-commands', form: 'notice', summary: 'maintenance report handoff (auto)' },
                    })
                    const woke = deliverHandoff(runAgent, autoMessage)
                    // Review P2-2: a receiver with neither primitive is NOT a silent case — the
                    // run and its report are committed, but nobody was told the model was never
                    // handed the pointer, so the operator has to see it.
                    if (woke === undefined) {
                      ctx.logger.warn(`evolution-commands: the automatic report handoff for run ${handle.id} could not be delivered — this host exposes neither followup nor inject; the report is at ${reportDigestPath({ id: handle.id, resultRef })}`)
                    }
                  } catch (error) {
                    ctx.logger.warn(`evolution-commands: automatic report handoff failed (${String(error)})`)
                  }
                }
              } else {
                ctx.logger.warn(`evolution-commands: maintenance run ${handle.id} produced no plan (${outcome.error ?? '原因未知'})`)
              }
            } catch (error) {
              // A throw is a settled run, not a stuck one: the registry gets the
              // failure and the operator can read it back after a restart.
              const aborted = handle.signal.aborted
              const failure = aborted
                ? 'cancelled: the scan was stopped before it settled'
                : `Maintenance scan failed: ${error instanceof Error ? error.message : String(error)}`
              await registry.settle(handle.id, { state: aborted ? 'cancelled' : 'failed', failure })
              ctx.logger.warn(`evolution-commands: maintenance run ${handle.id} threw (${failure})`)
            }
          })()
          return ok([
            `Maintenance run ${handle.id} started — the scan keeps running after this reply.`,
            `- status: /evolution maintain status ${handle.id}`,
            `- result: /evolution maintain report ${handle.id}`,
            `- stop:   /evolution maintain cancel ${handle.id}`,
          ].join('\n'))
        }
            break
          }
          default: break
        }
        if (input === 'consolidate' || input.startsWith('consolidate ')) {
          const plan = /--plan\s+(\S+)/.exec(input)?.[1]
          return err('`consolidate` 已退出用户面：机械追加由 curator 归档收尾，人类合成用 `/evolution merge pair <a> <b>`。' + (plan === undefined ? '' : '\n旧 --plan 审计只读保留：' + plan))
        }
        // 0.21.0 (G4/B4): the pin face. Same semantics as skill_manage's pin action — ONE library
        // method (setPinned), the same repository-worded answer, and the same E-70 decision that a
        // lifecycle-flag flip stays OUTSIDE the approval seam: staging it would let a request that
        // expires hold the library pinned invisibly, and the flip is reversible by the same command.
        // Like the tool, this is not a content write: no usage bump and no mutation event.
        // F-03: the grammar was a fragile single-space match —
        // `maintain  --timeout 600000` (multi-space) and `--timeout=600000`
        // fell into the unknown-args rejection below. `\s+` before the flag
        // and `[ =]` after it accept both spellings; trailing whitespace was
        // already tolerated and stays tolerated.
        // G7.4/C7: --timeout <ms> and --timeout=<ms> are the same flag to the parser.
        // An UNDECLARED flag keeps the old 'unknown arguments' answer: the table declares what this
        // subcommand accepts (C7), so a typo cannot silently become a bare flag.
        // G7.4/C7: the sub-form comes from the ONE parser; the table declares the flags.
        if (/^maintain\b/.test(input)) {
          // 0.3.14 (P3-2): an input that STARTS with maintain but did not
          // match the grammar (unknown flags, stray args) was silently falling
          // into the help branch despite the branch comment claiming explicit
          // rejection. Reject it here.
          // Review P2-5: the hint still demanded an id from `report`/`cancel` and never named
          // `handoff`, so it described a grammar two releases behind the one it guards.
          return err('未知的 maintain 参数：应为 `maintain`、`maintain --timeout <ms>` / `maintain --timeout=<ms>`、`maintain status [<id>]`、`maintain report [<id>]`、`maintain handoff [<id>]` 或 `maintain cancel [<id>]`。实际收到：' + input)
        }
        // G7.4/C7: the ONE parser answers the shape (flag order and `=` tolerated, F-4).
        if (input === '' || input === 'help') {
          return ok(hostCommandText(hostLocale, 'help.header') + '\n' + renderHelpText(hostLocale))
        }
        return err('/evolution ' + input + ' ' + hostCommandText(hostLocale, 'help.unknown') + '\n' + renderHint())
      },
    }
    /** The registered definition: declared members only (A46). */
    const evolutionCommand = {
      name: 'evolution',
      description: '自进化：状态与待批准写入',
      // F-5 (0.23.0, owner decision): this surface used to declare `recordInput: false`, so the
      // command text never reached the durable record. The decision is the OPPOSITE — an operator
      // must be able to reconstruct what was run — so the platform default (record the input)
      // applies and the line is gone. A stray `false` here would silently reverse it.
      input: {
        // input declaration: the frontend treats a declared-input command as
        // args-tolerant (leading claim keeps the whole rest, spaces included) —
        // without it, multi-word subcommands (skills health, curator run, …)
        // submit as the bare `/evolution` and the handler only ever sees the
        // help branch (field report 2026-08-31; /goal is the working precedent).
        // F-03 + WD1 (0.3.55): the hint renders FROM the subcommand registry
        // (single source with the help output and the README command table —
        // T-WD2 pins the equality).
        hint: renderHint(),
      },
      handler: (invocation: CommandInvocation): Promise<CommandResult> =>
        commandBody.run(invocation).catch((error: unknown): CommandResult => ({
          kind: 'error',
          text: `evolution：命令失败：${error instanceof Error ? error.message : String(error)}\n请运行 /evolution doctor 检查服务与状态文件；损坏的状态文件会被隔离为 <file> 以便检查。`,
        })),
    }
    commandCtx.effect(() => commands.register(evolutionCommand))
  })
  // G3: the platform's own legacy import knows only ITS entries, so a family section left in
  // the old document is never picked up by it. Run the (idempotent) migration once per mount,
  // from whichever trigger first has every prerequisite: the settings seat arriving (`inject`
  // fires with the service mounted), or the loader settling (the boot composition, which is
  // where the settings document comes from). The measured reason for two: an attempt anchored
  // only to a boot-time moment found the seat missing and wrote nothing, while the same code
  // run later migrated the same document — so the trigger, not the logic, was wrong.
  // Nothing here may fail a boot: a missing seat, an unresolvable home or an IO error warns once.
  let migrationRunning = false
  /**
   * A trigger that arrived while an attempt was in flight (T4-12/A54).
   *
   * The guard used to SWALLOW it, and the comment above claimed a failed attempt "re-arms the
   * guard for the next trigger" — but both triggers are lifecycle moments that have already
   * passed by then, so there was no next trigger: one failed attempt (a slow or unreadable legacy
   * document is enough) ended the automatic migration for that boot, leaving only a warning that
   * suggests running the command by hand. The trigger is queued here and consumed at the attempt's
   * settle point instead.
   */
  let migrationQueued = false
  /** The attempt failed: re-arm the guard, and run the queued trigger NOW (its only chance left). */
  const settleFailure = (): void => {
    migrationRunning = false
    if (!migrationQueued) return
    migrationQueued = false
    runMigrationOnce()
  }
  const runMigrationOnce = (): void => {
    if (migrationRunning) {
      migrationQueued = true
      return
    }
    migrationRunning = true
    void (async () => {
      try {
        const attempt = await migrateFromContext(ctx)
        if (!attempt.ok) {
          ctx.logger.warn('evolution-commands: the legacy settings migration cannot run here (no %s) — the boot migration retries automatically once that service is mounted', attempt.problem)
          settleFailure()
          return
        }
        const { outcome } = attempt
        if (outcome.source !== undefined && outcome.report !== undefined && outcome.report.written.length > 0) {
          ctx.logger.info('evolution-commands: migrated the legacy settings document (%s)', renderNamespaceMigration(outcome))
        }
        // A successful attempt keeps the guard closed and drops any queued trigger: the legacy
        // document is dealt with, so a second pass would be pointless work.
        migrationQueued = false
      } catch (error) {
        ctx.logger.warn('evolution-commands: the legacy settings migration did not run — %s', error instanceof Error ? error.message : String(error))
        settleFailure()
      }
    })()
  }
  // The settings service is what the migration writes through, so its availability IS the
  // trigger. Neither the service name nor the seat type is a declared edge of this plugin (the
  // family reads the settings surface through core's structural view), so the injection goes
  // through a narrow view of `inject`: one name, one callback, no new dependency edge.
  type SettingsSeatInjection = { inject: (names: readonly string[], callback: () => void) => unknown }
  const seatInjection = ctx as unknown as SettingsSeatInjection
  seatInjection.inject(['settings'], () => { runMigrationOnce() })
  // G6/W8: the diagnostics route is the browser face of the SAME view the CLI/--json renders.
  // registerHostRoutes waits on the platform's connection carrier and owns the route effect (W6);
  // a host without it stays inert (the command face keeps working).
  registerHostRoutes(ctx, () => [
    ...makeDiagnosticsRoutes(() => assembleDoctorInputs(ctx, {
      runs: doctorRuns(),
    })),
  ])
  void (async () => {
    const loader = (ctx.root as { loader?: { await?(): Promise<unknown> } }).loader
    try { await loader?.await?.() } catch { /* the loader reports its own failure; ours only needs a moment to try */ }
    runMigrationOnce()
  })()
}

export * from './command-catalog.ts'
