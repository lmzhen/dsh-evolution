/**
 * Human commands for the evolution family: /evolution learn|pending|curator|restore|consolidate|skills refresh.
 * @module @deepseek-ai/dsh-evolution-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { effectiveSessionPolicy, type ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
// 0.2.x replaced the shared `{ kind: 'plugin', plugin }` source with a merge-extensible
// map: each producer declares its own kind in its own module, and there is no shared
// catch-all plugin kind (llm/src/message.ts:103-115).
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'evolution-commands': { kind: 'evolution-commands' } & ContextFormed
  }
}
import {
  errorText, appendEvolutionEvent, assertSkillsRootAliasRetired, buildLearnPrompt, canonicalWriteId, clampedNumber, composePresetEntry, DEFAULT_SKILL_LIMITS, elapsedSince, mergePresetRow, PARAM_EXPOSURE, paramSettingsId, policyStageLimits, presetPatchText, presetRowId, type PolicyStageFields, type SettingsProviderLike, eventsFile, evolutionHome, evolutionRoot, isPresent, isUnknown, MAX_TIMER_DELAY_MS, newRunRegistry, probeText, reportsSweepLockTarget, resolveRootConfig, isMissingPath, newSkillLibrary, partitionVersions, sweepReports, transactIo, type EvolutionIoLike, type RunRecord, type RunRegistry, type SkillVersion } from '@deepseek-ai/dsh-evolution-core'
import { buildMaintainFacts, runMaintain, snapshotFromLibrary, type MaintainRuntime } from '@deepseek-ai/dsh-evolution-maintenance'
import { collectEvolutionBundles, diagnose, renderDoctorText } from './doctor.ts'
import { migrateFromContext, renderNamespaceMigration } from './migration.ts'
import { PROFILE_PATCH_FILENAME, baseRefusalReason, presetProfileTarget, resolvePresetBasePatch } from './preset-source.ts'
import { paramGroups, paramSurfaceRows, parseParamValue, renderParamJson, renderParamRows, renderPolicySet, type ParamSectionView } from './params.ts'
import { renderHelpText, renderHint } from './registry.ts'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  threatExemptLabels: z.array(z.string()).default([]),
})

/** Enrichment maps shared by the full scan and the `--facts` preview (v12). */
import { buildEnrichment, enrichmentSnapshotOptions } from '@deepseek-ai/dsh-evolution-maintenance'

/** One maintenance run's durable record — the body of its report JSON (0.19.0 / S2). */
interface MaintainReportRecord {
  runId: string
  verdict?: 'issues' | 'no_issues' | undefined
  recommendationCount?: number | undefined
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
async function writeMaintainReport(io: EvolutionIoLike, record: MaintainReportRecord, warn: (message: string) => void): Promise<string | undefined> {
  const dir = join(evolutionHome(), 'reports')
  const path = join(dir, `maintain-${record.runId}.json`)
  try {
    await io.writeText(path, JSON.stringify(record, null, 2))
    await io.writeText(join(dir, `maintain-${record.runId}.md`), record.text.trim() === '' ? `Maintenance run ${record.runId}: ${record.failure ?? 'no plan'}\n` : record.text)
  } catch {
    return undefined
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
  return path
}

/** Three-state read of a run's result: present, missing, or unreadable (never collapsed). */
async function readRunReport(io: EvolutionIoLike, record: RunRecord): Promise<{ kind: 'present'; text: string } | { kind: 'missing' } | { kind: 'unknown'; reason: string }> {
  const path = record.resultRef ?? join(evolutionHome(), 'reports', `maintain-${record.id}.json`)
  const probed = await probeText(io, path)
  if (isUnknown(probed)) return { kind: 'unknown', reason: probed.reason }
  if (!isPresent(probed)) return { kind: 'missing' }
  try {
    const parsed = JSON.parse(probed.value) as Partial<MaintainReportRecord>
    const header = `Maintenance run ${record.id} — ${record.state}${record.failure === undefined ? '' : ` (${record.failure})`}`
    const body = typeof parsed.text === 'string' && parsed.text.trim() !== '' ? parsed.text : renderRunRecord(record)
    return { kind: 'present', text: `${header}\n${body}` }
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
  let runs: RunRegistry | undefined
  ctx.inject(['evolutionIo'], (ioCtx) => {
    const ioRegistry = ioCtx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
    if (!ioRegistry) return
    const registry = newRunRegistry({
      io: ioRegistry.provider(),
      home: evolutionHome(),
      warn: message => { ctx.logger.warn(message) },
    })
    runs = registry
    void registry.load().then((loaded) => {
      // A run the previous process life left behind is reported, not hidden.
      if (!loaded.ok) ctx.logger.warn(`evolution-commands: the run index is not usable — ${loaded.note ?? 'unknown reason'}`)
      else if (loaded.note !== undefined) ctx.logger.warn(`evolution-commands: ${loaded.note}`)
    }).catch((error: unknown) => {
      ctx.logger.warn(`evolution-commands: could not read the run index (${error instanceof Error ? error.message : String(error)})`)
    })
    ioCtx.effect(() => () => {
      registry.cancelAll()
      runs = undefined
    }, 'evolution-commands.run-registry')
  })
  ctx.inject(['commands'], (commandCtx) => {
    // V27 G5.2: the platform's own `Context.commands` augmentation + its
    // `CommandDefinition` type are the contract here (previously a local
    // `CommandRuntimeLike { register(definition: unknown) }` and a hand-written
    // `CommandInvocation`, which silenced every upstream shape change: adding a
    // required member to the definition or the invocation failed to compile
    // nowhere in this family). `@deepseek-ai/dsh-commands` is a declared peer,
    // so the types resolve through the same package the platform mounts.
    const commands = commandCtx.commands
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
        // 0.3.80 functional check: branches that deliver into the session (or
        // attribute a write to it) dereferenced `invocation.agent` unguarded, so
        // a session-less caller (a script, a headless probe) got a raw TypeError
        // while every sibling branch answered with a documented E-3xx. ONE
        // accessor keeps that answer identical wherever the agent is required.
        const invocationAgent = invocation.agent as unknown as
          | (CommandInvocation['agent'] & { followup?: unknown; inject?: unknown })
          | undefined
        const agentMissing = (need: string): CommandResult | undefined => invocationAgent === undefined
          ? err(errorText('e-305-this-invocation-carries-no', { a1: need }))
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
          return err(errorText('e-306-this-deployment-stages-foreground', { a1: what }))
        }
        const approval = (ctx.get('evolutionApproval') as ApprovalLike | undefined)
        const pendingMatch = /^pending(?: --detail)?$/.exec(input)
        if (pendingMatch) {
          // 0.3.17 (S3.3): 'executing' rows (a previous approve crashed
          // mid-run) stay visible — approve will refuse to re-run them.
          // v29 CMD-05: the two lists come from independent provider
          // snapshots (jointly non-atomic) — a record pending at snapshot 1
          // and claimed executing before snapshot 2 appeared TWICE. Dedupe by
          // id with the later snapshot (executing) winning; pending-first
          // ordering preserved.
          // S1-F2: an unmounted approval service is NOT an empty queue — it
          // used to render as the success line below, so a degraded assembly
          // read "service unavailable" as "nothing in flight". Match the
          // E-301 posture of approve/reject instead.
          if (!approval) return err(errorText('e-301-approval-service-not-mounted'))
          const listed = [...await approval.list('pending'), ...await approval.list('executing')]
          const pending = [...new Map(listed.map(row => [row.id, row])).values()]
          // T4-09/A51: say which of the three human-confirmation states is in force. Reading through
          // list() also converged the window, so anything past the TTL is already closed as rejected
          // by the time these rows print — the note tells the operator that happened / can happen.
          const ttlMs = typeof approval.ttlMs === 'number' && Number.isFinite(approval.ttlMs) ? approval.ttlMs : 0
          const ttlNote = ttlMs > 0
            ? `\n(staged writes expire after ${ttlMs} ms: an expired write is closed as REJECTED and is never executed — stage it again if it is still wanted)`
            : '\n(staged writes never expire — the window waits for a decision; set the evolution-approval row pendingTtlMs to bound it)'
          if (pending.length === 0) return ok('No pending evolution writes.' + ttlNote)
          // F-328: `--detail` renders each record's staged args so an operator
          // reviews what approve will actually replay (the summary alone is a
          // 120-char label). The default (collapsed) view is unchanged.
          const detailed = pendingMatch[0] === 'pending --detail'
          // A staged write is a DECISION someone has to make, so the row carries when it was staged
          // and who staged it: an abandoned record and one from a minute ago must not look alike.
          // (The words are the command surface's own — English, like every other line it prints.)
          const nowMs = Date.now()
          const attribution = (p: { createdAt: string; origin?: string | undefined; sessionId?: string | undefined }): string => {
            const age = elapsedSince(p.createdAt, nowMs)
            const unit = age.n === 1 ? age.unit.replace(/s$/u, '') : age.unit
            const when = age.unit === 'now' ? 'just now' : `${age.n} ${unit} ago`
            const who = p.origin === undefined ? '' : `  from ${p.origin}`
            const session = p.sessionId === undefined ? '' : ` (session ${p.sessionId.slice(0, 8)})`
            return `  ·  ${when}${who}${session}`
          }
          const body = pending.map((p) => {
            if (!detailed) return `${p.id}  ${p.kind}  ${p.status === 'executing' ? 'EXECUTING ' : ''}${p.summary}${attribution(p)}`
            const status = p.status === 'executing' ? 'EXECUTING' : p.status
            const line = `${p.id}  ${p.kind}  ${status}  ${p.summary}${attribution(p)}`
            return p.args === undefined ? line : `${line}\n  staged args: ${safeStagedArgs(p.args)}`
          }).join('\n')
          const hint = pending.some(p => p.status === 'executing')
            ? '\n(EXECUTING: a previous approve may have crashed after running; verify the write manually, then reject — approve will not re-run it)'
            : ''
          return ok(body + hint + ttlNote)
        }
        if (input.startsWith('approve ')) {
          const id = input.slice(8).trim()
          const result = approval ? await approval.approve(id) : { ok: false, message: errorText('e-301-approval-service-not-mounted-2') }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input.startsWith('reject ')) {
          const id = input.slice(7).trim()
          const result = approval ? await approval.reject(id) : { ok: false, message: errorText('e-301-approval-service-not-mounted-2') }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input.startsWith('release ')) {
          // S2-P2-22: the operator exit for an ORPHANED executing record (an
          // approve that crashed mid-run) — returns it to the pending window
          // so it can be deliberately re-approved or rejected. A record whose
          // approve is still running in this process is refused (the in-flight
          // check lives in the approval service). v43 FLOW2-1: the service does
          // NOT assume it is the only live process — a claim naming a live
          // FOREIGN pid is refused there, and a claim carrying no pid cannot be
          // verified, so that release is a destructive operator action whose
          // message states the replay risk.
          const id = input.slice(8).trim()
          if (!approval) return err(errorText('e-301-approval-service-not-mounted-2'))
          if (!approval.release) return err(errorText('e-304-the-mounted-approval-service'))
          const result = await approval.release(id)
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input === 'curator run') {
          const curator = ctx.get('evolutionCurator') as { run(options?: { ignoreGates?: boolean }): Promise<{ stale: string[]; archived: string[]; errors: string[]; skipped?: string; report: { runId: string; snapshotPath?: string } }> } | undefined
          if (!curator) return err(errorText('e-302-curator-service-not-mounted'))
          const result = await curator.run({ ignoreGates: true })
          // D-12 (v18): a reentrant run that was skipped must not be reported
          // as a completed 0/0/0 pass.
          if (result.skipped !== undefined) {
            return ok(`Curator run skipped (${result.skipped}): no curation pass was executed.\nrunId=${result.report.runId}`)
          }
          return ok(`Curator run complete: ${result.stale.length} stale, ${result.archived.length} archived, ${result.errors.length} failed.\nrunId=${result.report.runId}${result.report.snapshotPath ? `\nsnapshot=${result.report.snapshotPath}` : ''}`)
        }
        if (input === 'curator pause' || input === 'curator resume') {
          const curator = ctx.get('evolutionCurator') as { setPaused(paused: boolean): Promise<void> } | undefined
          if (!curator) return err(errorText('e-302-curator-service-not-mounted'))
          const paused = input === 'curator pause'
          await curator.setPaused(paused)
          // H-07 completion: in a state-less composition the curator warns and
          // DROPS the write (setPaused is `Promise<void>`, so the loss cannot
          // travel through the return). Surface it on the command result so
          // the operator can tell a persisted pause from an ephemeral one.
          const stateMounted = ctx.get('evolutionState') !== undefined
          const notPersisted = stateMounted ? '' : '\nNOTE: no evolution state service is mounted — this setting is NOT persisted and will not survive this process.'
          return ok((paused
            ? 'Curator automatic curation paused. Manual /evolution curator run is unaffected; resume with /evolution curator resume.'
            : 'Curator automatic curation resumed. The next scheduled pass waits one interval (first-run defer semantics).') + notPersisted)
        }
        if (input === 'curator status') {
          const curator = ctx.get('evolutionCurator') as { status(): Promise<{ lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null> } | undefined
          if (!curator) return err(errorText('e-302-curator-service-not-mounted'))
          const state = await curator.status()
          if (!state) return ok('No curator state yet: the first automatic pass is deferred until the interval elapses.')
          // A corrupt state record must not crash the command surface with a
          // RangeError from `Invalid Date`.toISOString().
          const lastRun = typeof state.lastRunAt === 'number' && Number.isFinite(state.lastRunAt) && state.lastRunAt > 0
            ? new Date(state.lastRunAt).toISOString()
            : 'unknown'
          return ok([
            `paused=${state.paused}`,
            `runs=${state.runCount}`,
            `lastRun=${lastRun}`,
            `summary=${state.lastSummary}`,
          ].join('\n'))
        }
        if (input === 'mutations') {
          const curator = ctx.get('evolutionCurator') as { skills: { listMutations(): Promise<Array<{ at: string; skillName: string; action: string; summary: string }>> } } | undefined
          if (!curator) return err(errorText('e-302-curator-service-not-mounted'))
          const records: unknown = await curator.skills.listMutations()
          // V6-41 (0.3.36): the mutations file is out-of-band editable — a
          // damaged record must not crash the command with a TypeError (the
          // `curator status` command already has this posture).
          const usable = Array.isArray(records)
            ? records.filter((row): row is { at: string; skillName: string; action: string; summary: string } =>
              typeof row === 'object' && row !== null
              && typeof (row as { at?: unknown }).at === 'string'
              && typeof (row as { skillName?: unknown }).skillName === 'string'
              && typeof (row as { action?: unknown }).action === 'string'
              && typeof (row as { summary?: unknown }).summary === 'string')
            : []
          if (usable.length === 0) return ok('No mutation records yet.')
          const recent = usable.slice(-5).reverse().map(record => `${record.at.slice(0, 19)}  ${record.skillName}  ${record.action}  ${record.summary}`)
          return ok(`Mutations: ${usable.length} recorded (recent 5):\n${recent.join('\n')}`)
        }
        if (input === 'curator scope') {
          const curator = ctx.get('evolutionCurator') as { scopeView(): Promise<{ managed: string[]; watched: string[]; qualityWarned: string[]; exempted: string[]; protected: string[] }> } | undefined
          if (!curator) return err(errorText('e-302-curator-service-not-mounted'))
          const view = await curator.scopeView()
          const line = (label: string, names: string[]): string => `${label}: ${names.length}${names.length === 0 ? '' : `\n  ${names.join(', ')}`}`
          return ok([
            `Lifecycle scope at ${new Date().toISOString().slice(0, 10)}`,
            line('Managed (may transition)', view.managed),
            line('Watched (stale / quality-warned)', view.watched),
            line('Quality-warned', view.qualityWarned),
            line('Exempted (exclude / referenced)', view.exempted),
            line('Protected (pinned / bundled / hub / builtin)', view.protected),
          ].join('\n'))
        }
        if (input === 'curator report') {
          const curator = ctx.get('evolutionCurator') as { latestReport(): Promise<{ runId: string; startedAt: string; archived: Array<{ name: string }>; failed: Array<{ name: string; reason: string }>; aborted?: string; unattributed?: string[] } | null> } | undefined
          if (!curator) return err(errorText('e-302-curator-service-not-mounted'))
          const report: unknown = await curator.latestReport()
          if (!report) return ok('No curator report available.')
          // V6-41 (0.3.36): the report file is out-of-band editable — a damaged
          // shape must render "report unreadable" instead of an uncaught
          // TypeError (the `curator status` command already has this posture).
          if (typeof report !== 'object'
            || typeof (report as { runId?: unknown }).runId !== 'string'
            || typeof (report as { startedAt?: unknown }).startedAt !== 'string'
            || !Array.isArray((report as { archived?: unknown }).archived)
            || !Array.isArray((report as { failed?: unknown }).failed)) {
            return err('Report file unreadable.')
          }
          const reportAny = report as {
            runId: string
            startedAt: string
            archived: unknown[]
            failed: unknown[]
            // Out-of-band editable like every other field: read defensively.
            aborted?: unknown
            unattributed?: unknown
          }
          const nameOf = (item: unknown): string =>
            typeof item === 'object' && item !== null && typeof (item as { name?: unknown }).name === 'string'
              ? (item as { name: string }).name
              : '?'
          const reasonOf = (item: unknown): string =>
            typeof item === 'object' && item !== null && typeof (item as { reason?: unknown }).reason === 'string'
              ? (item as { reason: string }).reason
              : '?'
          // P2-16 (v38): an interrupted run reports failed=(none) and used to
          // read as a clean pass here, while the .md digest printed **Aborted**
          // (V27 CUR-2). Carry the same run-level facts on the command surface.
          const aborted = typeof reportAny.aborted === 'string' ? reportAny.aborted : undefined
          const unattributed = Array.isArray(reportAny.unattributed) ? reportAny.unattributed.length : 0
          const lines = [
            `runId=${reportAny.runId}`,
            `startedAt=${reportAny.startedAt}`,
            `archived=${reportAny.archived.map(nameOf).join(', ') || '(none)'}`,
            `failed=${reportAny.failed.map(item => `${nameOf(item)}: ${reasonOf(item)}`).join(', ') || '(none)'}`,
            ...aborted === undefined ? [] : [`aborted=${aborted}`],
            ...unattributed === 0 ? [] : [`unattributed=${unattributed}`],
          ]
          return ok(lines.join('\n'))
        }
        if (input === 'restore' || input.startsWith('restore ')) {
          // P0-2 (v11): the bare `restore` (registry/README documented usage)
          // fell into the help branch — the handler only matched the
          // argument-carrying shape. Both forms now reach restoreSnapshot.
          // P2-11 (v19): reject an unexpected tail. The v11 shape accepted any
          // argument and silently ran a WHOLE-TREE rollback, so an operator who
          // typed `/evolution restore <name>` (missing the `skill ` prefix)
          // triggered the destructive path by accident.
          const tail = input.slice('restore'.length).trim()
          if (tail !== '') {
            return err(`\`restore\` takes no arguments (got "${tail}"). Use \`restore\` for a whole-tree rollback, or \`skill restore <name>\` for one skill.`)
          }
          const restoreRefusal = unreplayableWriteRefusal('restore')
          if (restoreRefusal) return restoreRefusal
          const curator = ctx.get('evolutionCurator') as { restoreSnapshot(): Promise<{ ok: boolean; message: string }> } | undefined
          const result = curator ? await curator.restoreSnapshot() : { ok: false, message: errorText('e-302-curator-service-not-mounted') }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input.startsWith('consolidate ')) {
          const consolidateRefusal = unreplayableWriteRefusal('consolidate')
          if (consolidateRefusal) return consolidateRefusal
          const planTail = /\s--plan\s+(\S+)\s*$/.exec(input) ?? null
          const planRunId = planTail?.[1] ?? undefined
          const rest = planTail ? input.slice(0, planTail.index) : input
          const names = rest.slice(12).trim().split(/\s+/).filter(Boolean)
          const [target, ...sources] = names
          if (!target || sources.length === 0) return err('Usage: /evolution consolidate <target> <source...>')
          const curator = ctx.get('evolutionCurator') as { consolidate(target: string, sources: string[]): Promise<{ ok: boolean; message: string }> } | undefined
          const result = curator ? await curator.consolidate(target, sources) : { ok: false, message: errorText('e-302-curator-service-not-mounted') }
          if (!result.ok) return err(result.message)
          return ok(planRunId ? `${result.message}\n[audit] plan=${planRunId}` : result.message)
        }
        if (input.startsWith('skill restore ')) {
          const name = input.slice(14).trim()
          if (!name) return err('Usage: /evolution skill restore <name>')
          const skillRestoreRefusal = unreplayableWriteRefusal('skill restore')
          if (skillRestoreRefusal) return skillRestoreRefusal
          const curator = ctx.get('evolutionCurator') as { restore(name: string): Promise<{ ok: boolean; message: string }> } | undefined
          const result = curator ? await curator.restore(name) : { ok: false, message: errorText('e-302-curator-service-not-mounted') }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input.startsWith('skill history ')) {
          const name = input.slice(14).trim()
          if (!name) return err('Usage: /evolution skill history <name>')
          const curator = ctx.get('evolutionCurator') as {
            history(name: string): Promise<SkillVersion[]>
          } | undefined
          if (!curator) return err(errorText('e-302-curator-service-not-mounted'))
          const versions = await curator.history(name)
          if (versions.length === 0) return ok(`No content versions are recorded for "${name}" yet — they appear after the next write through skill_manage.`)
          // Content order, not append order: two writers of one skill can interleave their index
          // appends, and every entry written from 0.10.0 on links the version it replaced.
          const groups = partitionVersions(versions)
          const row = (entry: SkillVersion): string => `v${entry.v}\t${entry.at}\t${entry.action}\t${entry.chars} chars\t${entry.hash.slice(0, 12)}`
          const lines = [`Content versions for "${name}" (oldest first, ${groups.content.length} of at most the retained count):`, ...groups.content.map(row)]
          // Support files share this index; their bytes are history, but undo restores SKILL.md only,
          // so they are listed apart instead of being passed off as versions of the body.
          if (groups.support.length > 0) {
            lines.push('Support-file versions (history only — undo restores SKILL.md, not these bytes):', ...groups.support.map(row))
          }
          return ok(lines.join('\n'))
        }
        if (input.startsWith('skill undo ')) {
          const rest = input.slice(11).trim()
          const toMatch = /--to\s+v?(\d+)\s*$/.exec(rest)
          const name = (toMatch?.index === undefined ? rest : rest.slice(0, toMatch.index)).trim()
          if (!name) return err('Usage: /evolution skill undo <name> [--to v<N>]')
          const skillUndoRefusal = unreplayableWriteRefusal('skill undo')
          if (skillUndoRefusal) return skillUndoRefusal
          const curator = ctx.get('evolutionCurator') as { undo(name: string, v?: number): Promise<{ ok: boolean; message: string }> } | undefined
          const target = toMatch?.[1] === undefined ? undefined : Number(toMatch[1])
          const result = curator
            ? await (target === undefined ? curator.undo(name) : curator.undo(name, target))
            : { ok: false, message: errorText('e-302-curator-service-not-mounted') }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input === 'skills health') {
          const curator = ctx.get('evolutionCurator') as { healthView(): Promise<Array<{ name: string; verdict: string; reasons: string[] }>>; usageObserved(): Promise<boolean> } | undefined
          if (!curator) return err(errorText('e-302-curator-service-not-mounted'))
          const [rows, observed] = await Promise.all([curator.healthView(), curator.usageObserved()])
          // C observation window: before ANY observed read exists, view_count
          // zero is not evidence — say so instead of silently showing a clean
          // (or churn-skewed) verdict.
          const banner = observed ? '' : 'Usage observation not yet established — churn (write-ghost) rows are suppressed.'
          const line = (row: { verdict: string; name: string; reasons: string[] }): string => `${row.verdict.padEnd(18)} ${row.name}${row.reasons.length > 0 ? ` — ${row.reasons.join('; ')}` : ''}`
          if (rows.length === 0) return ok(banner ? `Structure health: all skills healthy. ${banner}` : 'Structure health: all skills healthy.')
          return ok([banner ? `Structure health (${rows.length} degraded): ${banner}` : `Structure health (${rows.length} degraded):`, ...rows.map(line)].join('\n'))
        }
        if (input === 'skills refresh') {
          // 0.3.18 (E-71): out-of-band tree edits (manual/git/other process)
          // bypass evolution/skill-mutated; this command drops the catalog's
          // summaries cache and invalidates the published skill catalog.
          ctx.emit('evolution/skills-refresh')
          return ok('Skill catalog refresh requested: caches dropped, catalog re-read on next lookup.')
        }
        if (input === 'learn' || input.startsWith('learn ')) {
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
            return err(errorText('e-305-the-invocation-agent-exposes'))
          }
          // rc.68: the learn action joins the event timeline (the loop
          // substrate). Soft probe: without the io registry the log is
          // skipped and the inject is never blocked.
          const registry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          const eventIo = registry?.provider()
          if (eventIo) {
            const home = evolutionRoot()
            void appendEvolutionEvent(eventIo, eventsFile(home), { type: 'learn', source: 'manual', ...(request ? { request } : {}) }).catch((error: unknown) => {
              ctx.logger.warn(`evolution-commands: failed to record learn event: ${String(error)}`)
            })
          }
          return woke
            ? ok('Learning request sent to this session. Follow it now.')
            : ok('Learning request queued for this session — this host exposes no wake-up channel, so it is read on your next message.')
        }
        if (input === 'maintain --facts') {
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
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('Evolution IO registry not mounted — maintenance facts unavailable.')
          const library = newSkillLibrary({ config: { root: skillsRootValue }, io: ioRegistry.provider() })
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
            return err(`maintenance scan could not read ${readFailures.length} listed skill(s) (${readFailures.slice(0, 10).join(', ')}${readFailures.length > 10 ? ', …' : ''}) and read no skill at all — the library was NOT audited; fix the unreadable skills (or their directory names) and run the scan again`)
          }
          if (snapshots.length === 0 && skillsRootValue !== ''
            && !(await ioRegistry.provider().exists(skillsRootValue))) {
            return err(`maintenance scan found an empty skill library, but the configured skill root does not exist (${skillsRootValue}) — point the skillsRoot config at a real directory (a literal \`~\` is not expanded) and run the scan again`)
          }
          // PLAN-R2 P2-10 (2026-09-16): cause 3 — no read failures and the
          // root probe confirmed the root exists, so the library is genuinely
          // empty. The full scan answers this with plain text and NO facts
          // block (orchestrate.ts: "Genuinely empty: no facts to review — do
          // not spend a model call"), so the preview returns the same verbatim
          // message instead of rendering an empty facts block that would
          // disagree with the scan it previews.
          if (snapshots.length === 0) {
            return ok('Maintenance scan: empty skill library. Nothing to do.')
          }
          const { facts } = buildMaintainFacts(snapshots, enrichment.usageObservedValue, undefined)
          return ok(`Maintenance facts (0-token preview):\n${facts}`)
        }
        // F-03: the grammar was a fragile single-space match —
        // `maintain  --timeout 600000` (multi-space) and `--timeout=600000`
        // fell into the unknown-args rejection below. `\s+` before the flag
        // and `[ =]` after it accept both spellings; trailing whitespace was
        // already tolerated and stays tolerated.
        const maintainArgs = /^maintain(?:\s+--timeout[ =](\d+))?\s*$/.exec(input)
        if (maintainArgs) {
          // User-command maintenance RUN (design 011; async since 0.19.0 / S2).
          // Deterministic facts + one-shot subagent → a validated plan that is
          // PERSISTED as this run's report; the command only points at it. No
          // writes to the skill tree, no auto execution, fail-closed when a
          // dependency is missing. `--timeout <ms>` overrides the deadline for
          // THIS run — no file edit, no restart.
          const runTimeoutMs = maintainArgs[1] ? Number(maintainArgs[1]) : (config.maintainTimeoutMs ?? 600_000)
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
            return err(maintainArgs[1]
              ? `Invalid --timeout value: expected a positive integer number of milliseconds up to ${MAX_TIMER_DELAY_MS} (e.g. /evolution maintain --timeout 600000).`
              : `The maintainTimeoutMs config is invalid: expected a positive integer number of milliseconds up to ${MAX_TIMER_DELAY_MS}. Fix the evolution-commands row config (maintainTimeoutMs), then retry.`)
          }
          const registry = runs
          if (!registry) return err('Evolution IO registry not mounted — maintenance scan unavailable.')
          // I-5 (v37): the LOCAL view must match MaintainRuntime's tightened subagents
          // contract ('spawn' + a platform-shaped request); a wider local type made the
          // real service assignable while hiding a future miss from `tsc`.
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          const subagents = ctx.get('subagents') as MaintainRuntime['subagents'] | undefined
          if (!ioRegistry) return err('Evolution IO registry not mounted — maintenance scan unavailable.')
          if (!subagents) return err('Subagents service not mounted — maintenance scan unavailable.')
          // 0.19.0 (S2): the registry IS the concurrency guard — one owner for
          // "is a scan running" and "when did the last one settle", instead of the
          // three module globals that also lost the answer on a restart.
          const running = registry.inFlight('maintain')
          if (running) {
            const elapsed = Math.max(1, Math.round((Date.now() - running.startedAt) / 1000))
            // V10-08 (F-04): a refused scan is NOT a successful scan — the
            // rejection returns kind:'error' so a consumer can distinguish
            // "ran" from "refused" by the result type instead of matching prose.
            return err(`Maintenance run ${running.id} is already running (started ~${elapsed}s ago) — re-submitting now would start a second scan. Status: /evolution maintain status ${running.id}; stop it: /evolution maintain cancel ${running.id}.`)
          }
          // V8-07 (0.3.47): the cooldown joins the clampedNumber family — a
          // NaN used to disable the cooldown silently (`NaN > 0` is false,
          // exactly the repeated-model-call case this guards) and ±Infinity
          // made every resubmission cooldown-blocked forever.
          const cooldownMs = clampedNumber(config.maintainCooldownMs, 30_000, { min: 0 })
          const lastSettled = registry.lastSettledAt('maintain')
          const sinceLast = lastSettled === undefined ? Number.POSITIVE_INFINITY : Date.now() - lastSettled
          if (cooldownMs > 0 && sinceLast < cooldownMs) {
            const remaining = Math.ceil((cooldownMs - sinceLast) / 1000)
            // V10-08 (F-04): same contract as the in-flight refusal above.
            // P3-21 (v14): the newest TERMINAL run is named from the registry, so a
            // failed first scan no longer prints an empty id.
            const latest = registry.runs().find(record => record.kind === 'maintain' && record.state !== 'running')
            return err(`Maintenance cooldown active (${remaining}s)${latest === undefined ? '' : ` — latest run ${latest.id}`}; re-running now would spend another model call.`)
          }
          const handle = registry.begin('maintain')
          // Detached on purpose. The command answers with a POINTER while the scan
          // keeps working: its lifetime is the handle's, and what stops it is
          // `cancel <id>` or this plugin's dispose — NOT the requesting invocation.
          // Measured: the desktop shell ends a request at ~305 s, which used to
          // abort a scan that was still working (and the family's own 600 s budget
          // could never fire first).
          void (async (): Promise<void> => {
            try {
              const library = newSkillLibrary({ config: { root: skillsRootValue }, io: ioRegistry.provider() })
              const enrichment = await buildEnrichment(ctx, library)
              const outcome = await runMaintain(
                {
                  library,
                  subagents,
                  parent: invocation.agent,
                  // E-55 (0.3.18): same-source model routing — the maintain subagent
                  // reads evolutionPolicy.get().curatorModel exactly like the curator.
                  // F-02: the tools registry rides along as a soft probe so
                  // the orchestrator can degrade the subagent toolFilter when the
                  // host bundle's maintenance_probe row is not mounted.
                  evolutionPolicy: { get: () => (ctx.get('evolutionPolicy') as { get(): { curatorModel?: string | undefined } } | undefined)?.get() },
                  tools: { get: (name: string) => (ctx.get('tools') as { get(name: string): unknown } | undefined)?.get(name) },
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
                ...(outcome.ok ? { verdict: outcome.verdict, recommendationCount: outcome.recommendationCount } : {}),
                ...(outcome.ok ? {} : { failure: handle.signal.aborted ? 'cancelled: the scan was stopped before it settled' : (outcome.error ?? 'Maintenance scan failed.') }),
                startedAt: handle.startedAt,
                endedAt,
                text: outcome.text ?? '',
              }, message => { ctx.logger.warn(message) })
              const state = outcome.ok ? 'succeeded' : (handle.signal.aborted ? 'cancelled' : 'failed')
              await registry.settle(handle.id, {
                state,
                ...(resultRef === undefined ? {} : { resultRef }),
                ...(outcome.ok ? {} : { failure: handle.signal.aborted ? 'cancelled: the scan was stopped before it settled' : (outcome.error ?? 'Maintenance scan failed.') }),
              })
              if (outcome.ok) {
                const home = evolutionRoot()
                void appendEvolutionEvent(ioRegistry.provider(), eventsFile(home), {
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
              } else {
                ctx.logger.warn(`evolution-commands: maintenance run ${handle.id} produced no plan (${outcome.error ?? 'unknown reason'})`)
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
        const maintainStatus = /^maintain\s+status(?:\s+(\S+))?\s*$/.exec(input)
        if (maintainStatus) {
          const registry = runs
          if (!registry) return err('Evolution IO registry not mounted — run status unavailable.')
          const wanted = maintainStatus[1]
          if (wanted !== undefined) {
            const record = registry.find(wanted)
            if (!record) return err(`No run ${wanted} in this home — /evolution maintain status lists the recent ones.`)
            return ok(renderRunRecord(record))
          }
          const all = registry.runs().filter(record => record.kind === 'maintain')
          if (all.length === 0) return ok('No maintenance run recorded in this home yet — /evolution maintain starts one.')
          const live = all.filter(record => record.state === 'running')
          const recent = all.filter(record => record.state !== 'running').slice(0, 5)
          return ok([
            live.length === 0 ? 'No maintenance run in flight.' : `In flight:\n${live.map(renderRunRecord).join('\n')}`,
            recent.length === 0 ? '' : `Recent:\n${recent.map(renderRunRecord).join('\n')}`,
          ].filter(part => part !== '').join('\n'))
        }
        const maintainReport = /^maintain\s+report\s+(\S+)\s*$/.exec(input)
        if (maintainReport) {
          const registry = runs
          if (!registry) return err('Evolution IO registry not mounted — run results unavailable.')
          const record = registry.find(maintainReport[1])
          if (!record) return err(`No run ${maintainReport[1]} in this home — /evolution maintain status lists the recent ones.`)
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('Evolution IO registry not mounted — run results unavailable.')
          const probed = await readRunReport(ioRegistry.provider(), record)
          // "no result" and "an unreadable result" must not look alike (the
          // three-state rule the rest of the family follows).
          if (probed.kind === 'missing') {
            return err(`Run ${record.id} (${record.state}) has NO result: no report was written${record.failure === undefined ? '' : ` (${record.failure})`}.`)
          }
          if (probed.kind === 'unknown') return err(`Run ${record.id} has a report that could not be read (${probed.reason}) — this is not "no result".`)
          return ok(probed.text)
        }
        const maintainCancel = /^maintain\s+cancel\s+(\S+)\s*$/.exec(input)
        if (maintainCancel) {
          const registry = runs
          if (!registry) return err('Evolution IO registry not mounted — run cancellation unavailable.')
          const record = registry.find(maintainCancel[1])
          if (!record) return err(`No run ${maintainCancel[1]} in this home — /evolution maintain status lists the recent ones.`)
          if (!registry.cancel(record.id)) return err(`Run ${record.id} is already ${record.state} — nothing to cancel.`)
          return ok(`Maintenance run ${record.id} cancelled — the scan stops at its next checkpoint. /evolution maintain status ${record.id} shows the terminal state.`)
        }
        if (/^maintain\b/.test(input)) {
          // 0.3.14 (P3-2): an input that STARTS with maintain but did not
          // match the grammar (unknown flags, stray args) was silently falling
          // into the help branch despite the branch comment claiming explicit
          // rejection. Reject it here.
          return err('Unknown maintain arguments: expected `maintain`, `maintain --timeout <ms>` / `maintain --timeout=<ms>`, `maintain status [<id>]`, `maintain report <id>` or `maintain cancel <id>`. Got: ' + input)
        }
        const presetInstall = /^preset install(?: --base (\S+))?$/.exec(input)
        if (presetInstall !== null || /^preset\b/.test(input)) {
          // 0.3.75 (v41 §6.1): this path knew `standard` only, so an
          // npm-installed family could not reach the ptc variant at all. The
          // base table now lives in the agent package's bases.json — the SAME
          // file install-layered.mjs reads, so the two install paths cannot
          // disagree about ids or metadata names.
          if (presetInstall === null) {
            return err('Unknown preset arguments: expected `preset install` or `preset install --base <name>[,<name>...]` (the names live in the agent package\'s bases.json). Got: ' + input)
          }
          // v28 G3.2 (CMD-03): the same three-way mutual exclusion
          // install-layered.mjs enforces up front, applied at the command's
          // write boundary. Writing the preset product while the `all` bundle
          // (or the one-click preset bundle) is mounted in ANY profile of this
          // home double-mounts the four model rows and the next session that
          // selects the preset fails loud at startup. Doctor reports this
          // post-hoc; here it is refused pre-hoc. A clean host(-less) layered
          // home is unaffected (re-installs stay idempotent).
          {
            // v30 CMD-06: the enumeration must not degrade silently HERE —
            // an unreadable profiles dir would look like "no bundles" and the
            // double-mounting install would proceed (fail-open). The gate
            // refuses with guidance instead.
            // v34 INST-01: a per-profile manifest that cannot be read or
            // parsed is the same fail-open (its bundle rows become "unknown",
            // not "absent") — both scopes refuse.
            let installedBundles: string[]
            try {
              installedBundles = collectEvolutionBundles(evolutionRoot(), (error) => { throw error })
            } catch (enumerationError) {
              return err(`Refusing to install the layered Evolution preset: the home profile directory or one of its profile manifests could not be read (${enumerationError instanceof Error ? enumerationError.message : String(enumerationError)}) — the all/preset double-mount check could not run. Resolve access to the profiles directory and retry, or install via the layered installer, which enforces the same exclusion up front.`)
            }
            const allBundle = installedBundles.find(name => name === 'dsh-evolution-all' || name.endsWith('/dsh-evolution-all'))
            const presetBundle = installedBundles.find(name => name === 'dsh-evolution-preset' || name.endsWith('/dsh-evolution-preset'))
            if (allBundle || presetBundle) {
              return err(`Refusing to install the layered Evolution preset: "${allBundle ?? presetBundle}" is installed in this home — its model rows (tool-memory / tool-skill-manage / tool-session-query / skill-catalog) would double-mount with the preset's and the profile fails loud at startup. Keep ONE: remove the ${allBundle ? 'evolution-all bundle' : 'evolution-preset bundle'} before installing the layered preset (see /evolution doctor).`)
            }
          }
          // The deliverable is one ROW in the target profile's own patch layer
          // (0.2.x): the platform registry reads declared presets out of the
          // composition, and a preset the platform does not ship has to arrive
          // inside an `- insert:` entry — a plain entry would only override a row
          // of the same id (packages/boot/app-boot/tests/user-patches.spec.ts:47-64).
          // The base rows come from the bundle patch that declares the platform
          // preset; the row is composed by core's composer, so this path and the
          // source installer emit the same bytes.
          try {
            const source = resolveAgentPresetDir(import.meta.url)
            const table = readAgentPresetBases(source)
            // v41: the selection is a LIST (comma-separated) — a user who
            // switches between the standard and ptc platform presets wants both
            // variants, generated against the SAME runtime platform in one pass.
            // Every name is resolved before anything is written, so a typo in
            // the second entry cannot leave the first variant installed.
            const requestedRaw = presetInstall[1] ?? table.defaultBase
            const requested = [...new Set(requestedRaw.split(',').map(part => part.trim()).filter(part => part !== ''))]
            if (requested.length === 0) {
              return err(`No agent-preset base named — ${join(source, 'bases.json')} lists ${table.entries.map(entry => entry.name).join(', ')}`)
            }
            const selected = []
            for (const name of requested) {
              const entry = table.entries.find(candidate => candidate.name === name)
              if (entry === undefined) {
                return err(`Unknown agent-preset base "${name}" — ${join(source, 'bases.json')} lists ${table.entries.map(candidate => candidate.name).join(', ')}`)
              }
              selected.push(entry)
            }
            const deltaPath = join(source, 'agent.cordis.yml')
            if (!existsSync(deltaPath)) return err(`Preset file missing from ${source} — is the dsh-evolution-agent-preset package installed?`)
            const profile = presetProfileTarget(ctx)
            if (profile === undefined) return err('No profile is mounted in this process, so there is no profile patch to write the preset row into — run the command in a session started by `dsh --profile <name>`.')
            const delta = readFileSync(deltaPath, 'utf8')
            const current = existsSync(profile.patchPath) ? readFileSync(profile.patchPath, 'utf8') : ''
            let merged = current
            const written: string[] = []
            for (const base of selected) {
              // 0.3.78 (G1-②), single-sourced in v46 S2.8: the two refusals live in
              // ONE function (`baseRefusalReason`) that `/evolution doctor` reads too,
              // and the service precondition is asked of the RUNTIME — the exact
              // reason a later mount would refuse. The source-checkout installer asks
              // the target profile's bundle rows instead, because it runs outside the
              // host.
              const refusal = baseRefusalReason(base, name => ctx.get(name) !== undefined)
              if (refusal !== undefined) return err(refusal)
              const basePatch = resolvePresetBasePatch(base.name, profile)
              const rowId = presetRowId(base.id)
              const entryText = composePresetEntry(readFileSync(basePatch, 'utf8'), delta, {
                rowId,
                id: base.id,
                name: base.display.name,
                description: base.display.description,
                order: base.display.order,
              })
              const next = mergePresetRow(merged, entryText, rowId)
              written.push(next === merged ? `${base.name} → ${profile.patchPath} (already current)` : `${base.name} → ${rowId} in ${profile.patchPath}`)
              merged = next
            }
            if (merged !== current) {
              // S6.3 (E-40): commit atomically — the file is staged to a sibling
              // `<name>.tmp` and renamed into place, a pre-existing file keeping a
              // single `.bak`, so a failed write leaves the previous patch (and
              // every session that reads it) untouched.
              atomicWriteFiles(dirname(profile.patchPath), [
                { name: PROFILE_PATCH_FILENAME, content: presetPatchText(merged) },
              ], undefined, (message) => { ctx.logger.warn(message) })
            }
            return ok(`Evolution agent preset row installed (${written.join('; ')}). Restart the session switcher to select it.`)
          } catch (error) {
            return err(`Preset install failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        if (input.startsWith('restructure ')) {
          // /evolution restructure <name> "<heading>" <to_file> [--plan <runId>]
          // — bridges the existing SkillLibrary.restructure (two-phase
          // rollback + origin gate); one move per invocation; heading may
          // contain spaces. `--plan` back-references a maintain scan runId
          // (011 §10 audit chain; shallow — annotated in the result text).
          // V25-08 (v25): parsed from the ORIGINAL trimmed input so a
          // quoted heading keeps its inner spacing verbatim.
          const planTail = /\s--plan\s+(\S+)\s*$/.exec(rawInputTrimmed) ?? null
          const planRunId = planTail?.[1] ?? undefined
          const rest = planTail ? rawInputTrimmed.slice(0, planTail.index) : rawInputTrimmed
          const match = /^restructure\s+(\S+)\s+"([^"]+)"\s+(\S+)$/.exec(rest)
          if (!match) return err('Usage: /evolution restructure <name> "<## heading>" <to_file>')
          const name = match[1] ?? ''
          const heading = match[2] ?? ''
          const toFile = match[3] ?? ''
          if (!toFile.startsWith('references/')) return err('to_file must live under references/ (log/detail destination).')
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('Evolution IO registry not mounted — restructure unavailable.')
          // v20 (D-2 / P2-8): the write joins the approval seam like every
          // other user-facing skill write — an approval-enabled deployment
          // must not have a command path that lands the same kind of write
          // directly (the family contract learning-graph's P2-6 states for
          // /graph). When the service is absent, disabled, or staging will
          // not happen, `request` returns 'allow' and the direct write below
          // runs unchanged. The pre-check refuses only the combination that
          // would stage a record nobody could ever replay (P1-9 trap).
          if (approval) {
            // V24-10 (v24): the session now rides the request, exactly like
            // the two same-family staging surfaces (tool-skill-manage and
            // learning-graph). The previous `effectiveSessionPolicy(ctx,
            // undefined)` was a constant-undefined dead call — the helper's
            // own contract returns undefined when the session is missing — so
            // a session/deployment `'never'` policy never reached this write
            // face and the staged record carried no sessionId attribution.
            const session = invocationAgent?.session
            const sessionPolicy = effectiveSessionPolicy(ctx, session)
            const stagesForeground = approval.isEnabled !== false
              && sessionPolicy !== 'never'
              && approval.stageForeground !== false
            // PLAN S5.5 (2026-09-16, audit P2-23): in a staging deployment a
            // session-less invocation (the E-305 shape) slipped past `willStage`
            // — which gated only the hasRunner pre-check — into the
            // unconditional `approval.request` below WITHOUT a session: the
            // record landed with no session attribution, the exact V24-10
            // violation, while consolidate/restore refuse through the E-306
            // helper. Same structured refusal here; with a session present the
            // behavior is unchanged.
            if (stagesForeground && session === undefined) {
              return err(errorText('e-306-this-deployment-stages-foreground-2'))
            }
            const willStage = stagesForeground
            if (willStage && !approval.hasRunner('skill')) {
              return err('Restructure cannot be staged: no skill replay runner is registered — mount the tool-skill-manage row (evolution-agent preset, or evolution-all) or disable evolution-approval.')
            }
            const decision = await approval.request({
              kind: 'skill',
              summary: `/evolution restructure ${name}${planRunId ? ` (plan ${planRunId})` : ''}`,
              args: { operation: { action: 'restructure', name, restructure: [{ heading, to_file: toFile }] }, origin: 'foreground', libraryOrigin: 'foreground' },
              origin: 'foreground',
              // A session-less caller only reaches this request when staging
              // is OFF (the refusal above covers the staging deployment), so
              // a staged record still never lands without attribution.
              ...session !== undefined ? { sessionId: session.id, session } : {},
              ...sessionPolicy !== undefined ? { sessionPolicy } : {},
            })
            if (decision.action === 'staged') {
              return ok(`${decision.message}${planRunId ? `\n[audit] plan=${planRunId}` : ''}`)
            }
          }
          // V8-08 (0.3.47): the command's restructure write joins the single
          // write-sink discipline — the skill-catalog cache invalidation
          // event fires like every other mutating construction point.
          // P2-18 (V10-03): the write-side library receives the configured
          // threat-scan exemption labels — the core-side constructor option
          // field is named `threatExemptLabels` (P2-18 core batch; the field
          // name is the linkage contract, keep in sync). Empty/omitted keeps
          // the strict scan unchanged.
          const library = newSkillLibrary({
            config: { root: skillsRootValue },
            io: ioRegistry.provider(),
            ctx,
            threatExemptLabels: config.threatExemptLabels,
            // 0.5.0 (§16.7): the write-behind stages are deployment policy, so the
            // command's restructure honours exactly what skill_manage honours.
            limits: {
              ...DEFAULT_SKILL_LIMITS,
              ...policyStageLimits((ctx.get('evolutionPolicy') as { get?(): PolicyStageFields } | undefined)?.get?.()),
            },
          })
          const result = await library.restructure(name, [{ heading, toFile: toFile }], 'foreground')
          if (!result.ok) return err(result.message)
          // Same mutating observation surface as skill_manage performs for the
          // same action — the patch_count bump keeps the signals coherent.
          await (ctx.get('skillUsage') as { record?: (name: string, kind: 'patch') => Promise<void> } | undefined)?.record?.(name, 'patch')
          return ok(planRunId ? `${result.message}\n[audit] plan=${planRunId}` : result.message)
        }
        if (input === 'replay') {
          const replay = ctx.get('evolutionReplay') as { compare(): { report: string } } | undefined
          if (!replay) return err(errorText('e-303-replay-service-not-mounted'))
          return ok(replay.compare().report)
        }
        const paramsMatch = /^params(?: --group ([a-z-]+))?(?: --json)?$/.exec(input)
        if (paramsMatch) {
          // S4.1: the READ face over the registry. Read-only and 0-token — the
          // text renders in the command surface, exactly like `maintain --facts`.
          const provider = ctx.get('settings') as SettingsProviderLike | undefined
          const sections = new Map<string, ParamSectionView>()
          if (provider?.describe !== undefined) {
            try {
              for (const descriptor of provider.describe({ redactSecrets: false })) {
                // The family registry declares no secret field, and the verbatim
                // view is what makes `user` answerable — it never leaves this process.
                const section: ParamSectionView = {}
                if (descriptor.user !== undefined) section.user = descriptor.user
                const resolved = descriptor.value
                if (typeof resolved === 'object' && resolved !== null) section.value = resolved as Record<string, unknown>
                sections.set(descriptor.ns, section)
              }
            } catch (error) {
              // Unreadable is NOT "no overrides" (the S3.x posture): refuse instead
              // of rendering every row as if the user had set nothing.
              return err(errorText('e-307-the-settings-service-could', { a1: error instanceof Error ? error.message : String(error) }))
            }
          }
          const rows = paramSurfaceRows(sections, PARAM_EXPOSURE)
          const group = paramsMatch[1]
          const selected = group === undefined ? rows : rows.filter(row => row.group === group)
          if (group !== undefined && selected.length === 0) {
            return err(errorText('e-308-unknown-parameter-group-group', { a1: group, a2: paramGroups(PARAM_EXPOSURE).join(', ') }))
          }
          if (input.endsWith('--json')) return ok(renderParamJson(selected))
          return ok(renderParamRows(selected, { providerMounted: provider !== undefined }))
        }
        const policySetMatch = /^policy set ([A-Za-z][A-Za-z0-9.-]*) (.+?)(?: --expect (\d+))?$/.exec(input)
        if (policySetMatch) {
          // S4.2: the WRITE face. One path only — the settings service. There is
          // deliberately no YAML fallback: a command that edits cordis.yml would
          // be a second write path to the same fact (design §8.3).
          const provider = ctx.get('settings') as SettingsProviderLike | undefined
          if (provider?.update === undefined || provider.describe === undefined) {
            return err(errorText('e-311-no-settings-service-is'))
          }
          const rawId = policySetMatch[1] ?? ''
          const rawValue = policySetMatch[2] ?? ''
          let id: string
          try {
            id = canonicalWriteId(rawId)
          } catch (error) {
            return err(errorText('e-312-error-instanceof-Error-error', { a1: error instanceof Error ? error.message : String(error) }))
          }
          const entry = PARAM_EXPOSURE.find(candidate => candidate.id === id)
          if (entry === undefined) {
            return err(errorText('e-313-unknown-parameter-id-evolution', { a1: id }))
          }
          if (entry.tier !== 'E3') {
            return err(errorText('e-314-id-is-a-deployment', { a1: id, a2: entry.tier, a3: entry.owner }))
          }
          // The platform keys the section by the Loader entry id (the row id), never by the
          // legacy namespace the 0.1.x seam registered: see core's `paramSettingsId`.
          const namespace = paramSettingsId(entry.owner)
          if (namespace === undefined) {
            return err(errorText('e-315-id-has-no-user', { a1: id, a2: entry.owner }))
          }
          let descriptor: { ns: string; value?: unknown; user?: Record<string, unknown>; revision?: number } | undefined
          try {
            descriptor = provider.describe({ redactSecrets: false }).find(candidate => candidate.ns === namespace)
          } catch (error) {
            return err(errorText('e-307-the-settings-service-could-2', { a1: error instanceof Error ? error.message : String(error) }))
          }
          if (descriptor === undefined) {
            return err(errorText('e-316-namespace-namespace-is-not', { a1: namespace, a2: entry.owner }))
          }
          const current = descriptor.value
          const resolved = typeof current === 'object' && current !== null ? current as Record<string, unknown> : undefined
          const expectedRaw = policySetMatch[3]
          const expected = expectedRaw === undefined ? descriptor.revision : Number(expectedRaw)
          if (expectedRaw !== undefined && descriptor.revision !== undefined && Number(expectedRaw) !== descriptor.revision) {
            return err(errorText('e-309-revision-conflict-you-sent', { a1: expectedRaw, a2: descriptor.revision }))
          }
          const value = parseParamValue(rawValue)
          try {
            await provider.update(namespace, { [id]: value }, expected)
          } catch (error) {
            const code = (error as { code?: unknown } | null)?.code
            const message = error instanceof Error ? error.message : String(error)
            if (code === 'SETTINGS_CONFLICT') {
              return err(errorText('e-309-revision-conflict-message-Re', { a1: message }))
            }
            return err(errorText('e-310-the-settings-service-refused', { a1: message }))
          }
          return ok(renderPolicySet({
            id, namespace, applies: entry.applies,
            before: descriptor.user?.[id] ?? resolved?.[id],
            after: value,
            wasOverridden: descriptor.user !== undefined && Object.hasOwn(descriptor.user, id),
          }))
        }
        if (input === 'migrate') {
          // G3: the platform's own legacy import only handles ITS sections; the family's old
          // namespaces are left in the renamed document. Idempotent by construction (equal
          // values write nothing), so this is safe to run as often as the operator likes.
          const attempt = await migrateFromContext(ctx)
          if (!attempt.ok) {
            if (attempt.problem === 'settings') return err(errorText('e-311-no-settings-service-is'))
            if (attempt.problem === 'home') return err(errorText('e-320-the-profile-home-is-not'))
            return err(errorText('e-321-no-io-provider-is'))
          }
          return ok(renderNamespaceMigration(attempt.outcome))
        }
        if (input === 'doctor' || input === 'doctor --json') {
          // WB2 (0.3.55): read-only self-check — install form, conflicts, env,
          // mounted services, pending count. `--json` feeds scripts.
          const report = await diagnose(ctx, { home: evolutionRoot() })
          if (input === 'doctor --json') return ok(JSON.stringify(report, null, 2))
          return ok(renderDoctorText(report))
        }
        // T4-03 (P2): an UNMATCHED subcommand is an error. The old fallback answered
        // `kind: 'success'` with the full help text, so `/evolution approve` (no id),
        // `/evolution skill` and `/evolution params --group` all read as successful commands — the
        // same silent-success shape `/evolution maintain --bogus` already refuses. Only the bare
        // command (and an explicit `help`) answer with the list, and they still answer success.
        if (input === '' || input === 'help') {
          return ok(`自进化：记忆、技能、会话回顾、技能整理——状态、待批准写入与维护。\n${renderHelpText()}`)
        }
        return err(`/evolution ${input} is not a subcommand this build answers (a known subcommand whose argument is missing lands here too).\n${renderHint()}`)
      },
    }
    /** The registered definition: declared members only (A46). */
    const evolutionCommand = {
      name: 'evolution',
      description: '自进化：状态与待批准写入',
      recordInput: false,
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
          text: `evolution: command failed: ${error instanceof Error ? error.message : String(error)}\nRun /evolution doctor to inspect services and state files; a corrupted state file is quarantined as <file>.corrupt for inspection.`,
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
          ctx.logger.warn('evolution-commands: the legacy settings migration cannot run here (no %s) — run /evolution migrate after that service is mounted', attempt.problem)
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
  void (async () => {
    const loader = (ctx.root as { loader?: { await?(): Promise<unknown> } }).loader
    try { await loader?.await?.() } catch { /* the loader reports its own failure; ours only needs a moment to try */ }
    runMigrationOnce()
  })()
}

/**
 * 0.3.14 (P1-1): locate the installed `dsh-evolution-agent-preset` package
 * (the delivery container for agent.cordis.yml/bases.json). Resolution order:
 * npm-name sibling (published profile layout), dev-tree sibling (source/test
 * layout), then module resolution. The package dir name differs from the npm
 * name (`evolution-agent` vs `@lmzhen/dsh-evolution-agent-preset` — the rc.44
 * dir≠name trap), so BOTH sibling shapes are probed.
 */
/** The agent-preset base table (evolution-agent/bases.json). The installer
 * (install-layered.mjs) reads the SAME file — the literal that used to live in
 * each of them is what kept this path on `standard` while the installer knew
 * `ptc` too. Fails loud: a missing table is an incomplete install, never a
 * silent fallback to the default base. */
function readAgentPresetBases(source: string): {
  defaultBase: string
  entries: Array<{
    name: string
    id: string
    display: { name: string; description: string; order: number }
    requires?: { service: string }
    unsupported?: string
  }>
} {
  const path = join(source, 'bases.json')
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { default?: unknown; bases?: unknown }
  if (!Array.isArray(parsed.bases) || parsed.bases.length === 0) throw new Error(`${path} carries no bases[]`)
  const entries = parsed.bases.map((raw) => {
    const entry = raw as { name?: unknown; id?: unknown; display?: unknown; requires?: unknown; unsupported?: unknown }
    if (typeof entry.name !== 'string' || typeof entry.id !== 'string') {
      throw new Error(`${path} entry ${JSON.stringify(raw)} needs name/id strings`)
    }
    // The display copy is the row's PUBLISHED identity: the platform localizes
    // its own shipped ids only (agent-preset-registry/src/display.ts:47-72), so a
    // row without a name lists as its bare id.
    const display = entry.display as { name?: unknown; description?: unknown; order?: unknown } | null | undefined
    if (display === null || typeof display !== 'object'
      || typeof display.name !== 'string' || display.name === ''
      || typeof display.description !== 'string' || display.description === ''
      || typeof display.order !== 'number' || !Number.isInteger(display.order)) {
      throw new Error(`${path} entry "${entry.name}" needs display { name, description, order }`)
    }
    const requires = entry.requires as { service?: unknown } | null | undefined
    if (requires !== undefined && (requires === null || typeof requires !== 'object' || typeof requires.service !== 'string')) {
      throw new Error(`${path} entry "${entry.name}" needs requires.service as a string`)
    }
    if (entry.unsupported !== undefined && (typeof entry.unsupported !== 'string' || entry.unsupported === '')) {
      throw new Error(`${path} entry "${entry.name}" needs unsupported as a non-empty reason string`)
    }
    return {
      name: entry.name,
      id: entry.id,
      display: { name: display.name, description: display.description, order: display.order },
      ...(requires === undefined ? {} : { requires: { service: requires.service as string } }),
      ...(entry.unsupported === undefined ? {} : { unsupported: entry.unsupported }),
    }
  })
  const declared = parsed.default
  if (typeof declared !== 'string' || !entries.some(entry => entry.name === declared)) {
    throw new Error(`${path} default ${JSON.stringify(declared)} is not one of ${entries.map(entry => entry.name).join(', ')}`)
  }
  return { defaultBase: declared, entries }
}

function resolveAgentPresetDir(importMetaUrl: string): string {
  const dir = dirname(fileURLToPath(importMetaUrl))
  // D-13 (v18): the overlay sibling is `evolution-agent` two levels up
  // (`packages/evolution/<pkg>/src` or `packages/<pkg>/src`). The old first
  // candidate `join(dir, '..', 'dsh-evolution-agent-preset')` pointed INSIDE
  // this package in every layout (dead path).
  const overlayCandidate = join(dir, '..', '..', 'evolution-agent')
  if (existsSync(join(overlayCandidate, 'agent.cordis.yml')) && existsSync(join(overlayCandidate, 'bases.json'))) return overlayCandidate
  try {
    return dirname(createRequire(importMetaUrl).resolve('@deepseek-ai/dsh-evolution-agent-preset/package.json'))
  } catch {
    // S6.6-1 (E-64): last-resort overlay path; the caller's existsSync guard
    // turns a wrong path into a clean error.
    return overlayCandidate
  }
}

/** F-211: the fs surface atomicWriteFiles uses — injectable so the commit-phase
 * rename-failure path is deterministically testable. Defaults to node:fs.
 * `mtime` (optional) probes a path's last-write time so the failed-commit
 * recovery message can name the generation it restored from. */
interface FsOps {
  writeFileSync(path: string, data: string | Uint8Array): void
  existsSync(path: string): boolean
  copyFileSync(from: string, to: string): void
  renameSync(from: string, to: string): void
  rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void
  mtime?(path: string): number | null
}

const defaultFs: FsOps = {
  writeFileSync: (path, data) => { writeFileSync(path, data) },
  existsSync: path => existsSync(path),
  copyFileSync: (from, to) => { copyFileSync(from, to) },
  renameSync: (from, to) => { renameSync(from, to) },
  rmSync: (path, options) => { rmSync(path, options) },
  // N14: only a MISSING file is "no mtime" (null). Any other stat failure
  // rejects, so probeMtime() reports it as unknown instead of as absent.
  mtime: (path) => {
    try { return statSync(path).mtimeMs } catch (error) {
      // v43 S1-4: the canonical predicate (core/probe.ts) — one definition of
      // "this read failure means it is not there" instead of a second copy.
      if (isMissingPath(error)) return null
      throw error
    }
  },
}

/**
 * S6.3 (E-40): atomically replace a set of files within one directory.
 * Each file is staged to a sibling `<name>.tmp`, then renamed into place
 * (atomic on the same filesystem); a pre-existing file keeps a single
 * `<name>.bak`. A failure at ANY staging step removes the staged temps and
 * leaves the previous files untouched — a half-written target is impossible
 * up to the staging and backup phases.
 *
 * F-211: the rename COMMIT phase does not carry the same guarantee. When a
 * filesystem refuses to overwrite the destination, the code removes it and
 * retries the rename; if the retry ALSO fails the destination is gone. The
 * single `.bak` created above still holds the previous content, so the target
 * is restored from it (best-effort) before the original rename error is
 * rethrown, so a failed commit never leaves the file missing.
 *
 * V4-17: the `.bak` is refreshed to the committed content after every
 * successful commit, so a later failed commit always recovers to the most
 * recent good generation (a once-at-first-install `.bak` could otherwise
 * restore content several installs old). The recovery error names the `.bak`
 * source (and mtime when available) so the caller knows the generation it
 * restored from.
 */
export function atomicWriteFiles(
  targetDir: string,
  writes: Array<{ name: string; content: string | Uint8Array }>,
  fs: FsOps = defaultFs,
  // F3 (P2-19, v11): warnings go through the caller's logger (the runtime
  // pipeline), not a raw console.warn — the .bak-refresh failure is a
  // real production event and must be observable in the operator logs.
  logger: (message: string) => void = console.warn,
): void {
  const stage = (name: string): string => join(targetDir, `${name}.tmp`)
  // V6-42 (0.3.36): a duplicate name makes the commit re-visit the same
  // target: the second rename ENOENTs (the tmp already moved), then the
  // remove-then-rename recovery DELETES the file the first commit just
  // installed and restores an old `.bak` generation — a self-referential,
  // confusing failure. Fail loud on the input instead.
  const dupes = [...new Set(writes.map(write => write.name).filter((name, index, all) => all.indexOf(name) !== index))]
  if (dupes.length > 0) {
    throw new Error(`atomicWriteFiles: duplicate input names: ${dupes.join(', ')}`)
  }
  try {
    for (const { name, content } of writes) fs.writeFileSync(stage(name), content)
    for (const { name } of writes) {
      const finalPath = join(targetDir, name)
      const bakPath = join(targetDir, `${name}.bak`)
      // Back up the currently installed file once, so an interrupted commit can
      // fall back to the previous usable composition.
      if (fs.existsSync(finalPath) && !fs.existsSync(bakPath)) fs.copyFileSync(finalPath, bakPath)
    }
    const committed: string[] = []
    for (const { name } of writes) {
      const finalPath = join(targetDir, name)
      const bakPath = join(targetDir, `${name}.bak`)
      const tmp = stage(name)
      try {
        fs.renameSync(tmp, finalPath)
        committed.push(name)
      } catch {
        // Some filesystems refuse to overwrite the destination; the single
        // .bak above already holds the previous file, so remove-then-rename is
        // safe here.
        try {
          fs.rmSync(finalPath, { force: true })
        } catch (removeError) {
          // V6-28 (0.3.36): a failed remove must not escape WITHOUT the
          // disclosure chain — `committed` is the only trace of a partial
          // install and the recovery narration would be lost (Windows: rename
          // and unlink often fail together with EPERM/EBUSY).
          const already = committed.length > 0 ? `; already committed: ${committed.join(', ')}` : ''
          throw new Error(`atomicWriteFiles: could not remove "${name}" to replace it (${removeError instanceof Error ? removeError.message : String(removeError)})${already}`)
        }
        try {
          fs.renameSync(tmp, finalPath)
          committed.push(name)
        } catch (renameError) {
          // F-211: the retry failed AFTER the target was removed — restore it
          // from .bak before surfacing the error, so the file is not left
          // missing. Best-effort: if the restore also fails, note that and
          // throw the original rename error so the caller still knows why.
          // V5-17 (0.3.31): a multi-file commit that fails midway is PARTIAL —
          // the error must disclose which files already landed (the caller is
          // otherwise told only about the file that failed).
          const already = committed.length > 0 ? `; already committed: ${committed.join(', ')}` : ''
          if (fs.existsSync(bakPath)) {
            try {
              fs.copyFileSync(bakPath, finalPath)
            } catch {
              throw new Error(`atomicWriteFiles: "${name}" was removed but recovery from ${bakPath} failed (${renameError instanceof Error ? renameError.message : String(renameError)}); verify the file manually${already}`)
            }
            // V4-17: recovery succeeded — name the source generation so a caller
            // is not misled into thinking the attempt actually landed.
            const bakMtime = fs.mtime?.(bakPath)
            const when = bakMtime !== null && bakMtime !== undefined && Number.isFinite(bakMtime) ? ` (bak mtime ${new Date(bakMtime).toISOString()})` : ''
            throw new Error(`atomicWriteFiles: "${name}" was removed during commit and restored from the last good generation ${bakPath}${when}; original error: ${renameError instanceof Error ? renameError.message : String(renameError)}${already}`)
          }
          throw new Error(`${renameError instanceof Error ? renameError.message : String(renameError)}${already}`)
        }
      }
    }
    // V4-17: a successful commit refreshes each .bak to the content that just
    // landed, so a later failed commit recovers to the most recent good
    // generation rather than one several installs ago (the backup phase above
    // only ever created a .bak on first install).
    // V5-17 (0.3.31): the refresh is best-effort maintenance — a failure here
    // must NOT turn a successful install into a reported failure, and must not
    // abort mid-loop (which would split the bak pair: some fresh, some old).
    for (const { name } of writes) {
      const finalPath = join(targetDir, name)
      try {
        if (fs.existsSync(finalPath)) fs.copyFileSync(finalPath, join(targetDir, `${name}.bak`))
      } catch (refreshError) {
        logger(`atomicWriteFiles: committed "${name}" but failed to refresh its .bak (${refreshError instanceof Error ? refreshError.message : String(refreshError)}); a later failed commit will recover to an OLDER generation`)
      }
    }
  } catch (error) {
    // OPT-24 (2026-09): the cleanup loop runs INSIDE the catch — an rmSync
    // that hits EPERM/EBUSY (Windows: AV indexer, open handle; force only
    // suppresses ENOENT) escaped the catch and REPLACED the carefully built
    // recovery diagnostic (including the already-committed disclosure), and
    // left the remaining staged temps behind. Cleanup failures are now
    // collected and appended to the original error; every temp gets its
    // removal attempt.
    const cleanupFailures: string[] = []
    for (const { name } of writes) {
      try {
        fs.rmSync(stage(name), { force: true, recursive: true })
      } catch (cleanupError) {
        cleanupFailures.push(`${name}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
      }
    }
    if (cleanupFailures.length > 0) {
      const original = error instanceof Error ? error.message : String(error)
      throw new Error(`${original} (staged-temp cleanup also failed: ${cleanupFailures.join('; ')})`)
    }
    throw error
  }
}

// V10-09 (F-05): countMaintainRecommendations / beforeNotesHeader were
// deleted — the recommendation count now travels as the structured
// `MaintainOutcome.recommendationCount` (validated plan length, filled by
// evolution-maintenance orchestrate). Parsing the rendered text (`/^- \[/gm`,
// `Notes:` splitting — with F-365/V4-26/V6-38 as two rounds of repair patches
// to that very parse) was a fragile cross-package text contract and is gone
// without a dual track; formatPlan's rendering itself is unchanged.

// V27 G5.2: the local `CommandInvocation` view and the
// `CommandRuntimeLike { register(definition: unknown) }` shim are gone — the
// platform's `@deepseek-ai/dsh-commands` types (imported above, declared as a
// peer dependency) type the registration and the invocation, so an upstream
// shape change fails this package's build instead of silently passing.
// 0.3.19 (W1.2): ApprovalLike is imported from evolution-approval (the one
// authoritative consumer shape) instead of a local view.

/** F-328: render staged args for `pending --detail`, truncated to 500 chars.
 * args may be non-JSON (a tool produced garbage), so the render is fail-safe.
 * V4-19: a truncation is marked with `…(truncated N chars)` so the operator is
 * never silently shown a partial JSON payload that could even split an escape
 * sequence — the marker makes the cut explicit rather than looking complete. */
function safeStagedArgs(args: unknown): string {
  try {
    const json = JSON.stringify(args)
    // F-13: a top-level undefined/function/symbol makes
    // JSON.stringify return `undefined` (it does not throw) — handled by this
    // explicit type branch instead of relying on a `.length` TypeError to
    // land in the catch below.
    if (typeof json !== 'string') return '(unserializable)'
    if (json.length > 500) return `${json.slice(0, 500)}…(truncated ${json.length - 500} chars)`
    return json
  } catch {
    // args is not JSON-serializable and stringifying THREW (circular refs,
    // BigInt, …) — render a stub so the pending surface never crashes on a
    // malformed staged payload.
    return '(unserializable)'
  }
}