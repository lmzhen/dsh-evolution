/**
 * Human commands for the evolution family: /evolution learn|pending|curator|restore|consolidate|skills refresh.
 * @module @deepseek-ai/dsh-evolution-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendEvolutionEvent, buildLearnPrompt, clampedNumber, composePresetComposition, eventsFile, evolutionRoot, resolveSkillsRoot, SkillLibrary, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { buildMaintainFacts, runMaintain, snapshotFromLibrary } from '@deepseek-ai/dsh-evolution-maintenance'
import { diagnose, renderDoctorText } from './doctor.ts'
import { renderHelpText, renderHint } from './registry.ts'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'evolution-commands'

export interface Config {
  /** Skill-tree root for maintain/restructure; empty uses skillsRoot().
   * Align with tool-skill-manage/skill-usage/evolution-skill-catalog rows (A7).
   * 0.3.22 (G3.2, F-342): resolved through resolveSkillsRoot() so an empty/
   * whitespace value falls back to the default instead of a CWD-relative root. */
  skillsRoot?: string | undefined
  /** Cooldown window for scan commands (ms) — misclick/rapid-trigger guard;
   * secondary calls inside the window return the previous runId instead of
   * spending another model call. Default 30s (0.3.5). NOTE: the window starts
   * AFTER a run settles (lastMaintainAt updates post-run) — it does NOT dedupe
   * in-flight runs, so the old 130s ">= timeout" rationale was a comment bug.
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

/** Enrichment maps shared by the full scan and the `--facts` preview (v12). */
import { buildEnrichment } from '@deepseek-ai/dsh-evolution-maintenance'

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const config = rawConfig
  let lastMaintainAt = 0
  let lastMaintainRunId = ''
  // 0.3.11 single-flight: 0.3.5 discovered the cooldown never covers in-flight
  // runs (lastMaintainAt updates AFTER settle) — a re-submit during a run
  // cancels it at the platform level. This flag answers re-triggers with
  // "already running" instead of spawning a second scan.
  let maintainInFlightSince = 0
  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: CommandRuntimeLike }).commands
    // M-11 (S6.2, E-29): bind the register disposer to the fiber — an unbound
    // registration survives reload/HMR and registers /evolution twice.
    // evolution-learning-graph is the aligned precedent
    // (commandCtx.effect(() => commands.register(...))).
    commandCtx.effect(() => commands.register({
      name: 'evolution',
      description: 'Self-evolution status and approval controls',
      recordInput: false,
      // input declaration: the frontend treats a declared-input command as
      // args-tolerant (leading claim keeps the whole rest, spaces included) —
      // without it, multi-word subcommands (skills health, curator run, …)
      // submit as the bare `/evolution` and the handler only ever sees the
      // help branch (field report 2026-08-31; /goal is the working precedent).
      input: {
        // F-03 + WD1 (0.3.55): the hint renders FROM the subcommand registry
        // (single source with the help output and the README command table —
        // T-WD2 pins the equality).
        hint: renderHint(),
      },
      async handler(invocation: CommandInvocation) {
        const input = invocation.rawInput?.trim() ?? ''
        const ok = (text: string) => ({ kind: 'success' as const, text })
        const err = (text: string) => ({ kind: 'error' as const, text })
        const approval = (ctx.get('evolutionApproval') as ApprovalLike | undefined)
        const pendingMatch = /^pending(?: --detail)?$/.exec(input)
        if (pendingMatch) {
          // 0.3.17 (S3.3): 'executing' rows (a previous approve crashed
          // mid-run) stay visible — approve will refuse to re-run them.
          const pending = approval ? [...await approval.list('pending'), ...await approval.list('executing')] : []
          if (pending.length === 0) return ok('No pending evolution writes.')
          // F-328: `--detail` renders each record's staged args so an operator
          // reviews what approve will actually replay (the summary alone is a
          // 120-char label). The default (collapsed) view is unchanged.
          const detailed = pendingMatch[0] === 'pending --detail'
          const body = pending.map((p) => {
            if (!detailed) return `${p.id}  ${p.kind}  ${p.status === 'executing' ? 'EXECUTING ' : ''}${p.summary}`
            const status = p.status === 'executing' ? 'EXECUTING' : p.status
            const line = `${p.id}  ${p.kind}  ${status}  ${p.summary}`
            return p.args === undefined ? line : `${line}\n  staged args: ${safeStagedArgs(p.args)}`
          }).join('\n')
          const hint = pending.some(p => p.status === 'executing')
            ? '\n(EXECUTING: a previous approve may have crashed after running; verify the write manually, then reject — approve will not re-run it)'
            : ''
          return ok(body + hint)
        }
        if (input.startsWith('approve ')) {
          const id = input.slice(8).trim()
          const result = approval ? await approval.approve(id) : { ok: false, message: 'approval service not mounted' }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input.startsWith('reject ')) {
          const id = input.slice(7).trim()
          const result = approval ? await approval.reject(id) : { ok: false, message: 'approval service not mounted' }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input === 'curator run') {
          const curator = ctx.get('evolutionCurator') as { run(options?: { ignoreGates?: boolean }): Promise<{ stale: string[]; archived: string[]; errors: string[]; report: { runId: string; snapshotPath?: string } }> } | undefined
          if (!curator) return err('Curator service not mounted.')
          const result = await curator.run({ ignoreGates: true })
          return ok(`Curator run complete: ${result.stale.length} stale, ${result.archived.length} archived, ${result.errors.length} failed.\nrunId=${result.report.runId}${result.report.snapshotPath ? `\nsnapshot=${result.report.snapshotPath}` : ''}`)
        }
        if (input === 'curator pause' || input === 'curator resume') {
          const curator = ctx.get('evolutionCurator') as { setPaused(paused: boolean): Promise<void> } | undefined
          if (!curator) return err('Curator service not mounted.')
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
          if (!curator) return err('Curator service not mounted.')
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
          if (!curator) return err('Curator service not mounted.')
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
          if (!curator) return err('Curator service not mounted.')
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
          const curator = ctx.get('evolutionCurator') as { latestReport(): Promise<{ runId: string; startedAt: string; archived: Array<{ name: string }>; failed: Array<{ name: string; reason: string }> } | null> } | undefined
          if (!curator) return err('Curator service not mounted.')
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
          }
          const nameOf = (item: unknown): string =>
            typeof item === 'object' && item !== null && typeof (item as { name?: unknown }).name === 'string'
              ? (item as { name: string }).name
              : '?'
          const reasonOf = (item: unknown): string =>
            typeof item === 'object' && item !== null && typeof (item as { reason?: unknown }).reason === 'string'
              ? (item as { reason: string }).reason
              : '?'
          const lines = [
            `runId=${reportAny.runId}`,
            `startedAt=${reportAny.startedAt}`,
            `archived=${reportAny.archived.map(nameOf).join(', ') || '(none)'}`,
            `failed=${reportAny.failed.map(item => `${nameOf(item)}: ${reasonOf(item)}`).join(', ') || '(none)'}`,
          ]
          return ok(lines.join('\n'))
        }
        if (input.startsWith('restore ')) {
          const curator = ctx.get('evolutionCurator') as { restoreSnapshot(): Promise<{ ok: boolean; message: string }> } | undefined
          const result = curator ? await curator.restoreSnapshot() : { ok: false, message: 'Curator service not mounted.' }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input.startsWith('consolidate ')) {
          const planTail = /\s--plan\s+(\S+)\s*$/.exec(input) ?? null
          const planRunId = planTail?.[1] ?? undefined
          const rest = planTail ? input.slice(0, planTail.index) : input
          const names = rest.slice(12).trim().split(/\s+/).filter(Boolean)
          const [target, ...sources] = names
          if (!target || sources.length === 0) return err('Usage: /evolution consolidate <target> <source...>')
          const curator = ctx.get('evolutionCurator') as { consolidate(target: string, sources: string[]): Promise<{ ok: boolean; message: string }> } | undefined
          const result = curator ? await curator.consolidate(target, sources) : { ok: false, message: 'Curator service not mounted.' }
          if (!result.ok) return err(result.message)
          return ok(planRunId ? `${result.message}\n[audit] plan=${planRunId}` : result.message)
        }
        if (input.startsWith('skill restore ')) {
          const name = input.slice(14).trim()
          if (!name) return err('Usage: /evolution skill restore <name>')
          const curator = ctx.get('evolutionCurator') as { restore(name: string): Promise<{ ok: boolean; message: string }> } | undefined
          const result = curator ? await curator.restore(name) : { ok: false, message: 'Curator service not mounted.' }
          return result.ok ? ok(result.message) : err(result.message)
        }
        if (input === 'skills health') {
          const curator = ctx.get('evolutionCurator') as { healthView(): Promise<Array<{ name: string; verdict: string; reasons: string[] }>>; usageObserved(): Promise<boolean> } | undefined
          if (!curator) return err('Curator service not mounted.')
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
          const request = input === 'learn' ? '' : input.slice(6).trim()
          // rc.67: command results never enter model history, so an echo can
          // never reach the agent. INJECT the learn prompt as a first-class
          // user message (same pattern as the auto-review inject path).
          // rc.70 F-2: always via createUserMessage — UserMessage requires
          // role:'user' plus the minted id; a bare object only works because
          // the DeepSeek adapter routes undefined-role into the user branch.
          invocation.agent.inject(createUserMessage({
            content: [{ type: 'text', text: buildLearnPrompt(request) }],
            source: { kind: 'plugin', plugin: 'dsh-evolution-commands', form: 'notice', summary: 'learn request' },
          }))
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
          return ok('Learning request sent to this session. Follow it now.')
        }
        if (input === 'maintain --facts') {
          // 0-token deterministic preview (011 §12-1 v12): facts block only,
          // no subagent call, no cooldown (the cooldown guards LLM calls).
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('Evolution IO registry not mounted — maintenance facts unavailable.')
          const library = new SkillLibrary(resolveSkillsRoot({ root: config.skillsRoot }), ioRegistry.provider())
          const enrichment = await buildEnrichment(ctx, library)
          const snapshots = await snapshotFromLibrary(library, {
            descriptions: enrichment.descriptions,
            supportFiles: enrichment.supportFiles,
            quality: enrichment.quality,
            protected: enrichment.protected,
            catalogInvalid: enrichment.catalogInvalid,
          })
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
          // User-command maintenance scan (design 011): deterministic facts +
          // one-shot subagent → validated plan display. No writes, no auto
          // execution; fail-closed when either dependency is missing. Scope
          // filtering is reserved (011 §3) — reject unknown args explicitly
          // instead of silently swallowing them. `--timeout <ms>` (0.3.4)
          // overrides the deadline for THIS run — no file edit, no restart.
          const runTimeoutMs = maintainArgs[1] ? Number(maintainArgs[1]) : (config.maintainTimeoutMs ?? 600_000)
          // V6-29 (0.3.36): AbortSignal.timeout throws a RangeError above 2^32-1
          // — reject the domain explicitly instead of surfacing the platform
          // error from a `--timeout` typo.
          if (!Number.isSafeInteger(runTimeoutMs) || runTimeoutMs <= 0 || runTimeoutMs > 0xFFFFFFFF) {
            return err('Invalid --timeout value: expected a positive integer number of milliseconds up to 4294967295 (e.g. /evolution maintain --timeout 600000).')
          }
          if (maintainInFlightSince > 0) {
            const running = Math.max(1, Math.round((Date.now() - maintainInFlightSince) / 1000))
            // V10-08 (F-04): a refused scan is NOT a successful scan — the
            // rejection returns kind:'error' so a consumer can distinguish
            // "ran" from "refused" by the result type instead of matching
            // prose. Behavior contract change (CHANGELOG-declared V10-08).
            return err(`Maintenance scan is already running (since ~${running}s ago) — re-submitting now would cancel it. Wait for it to settle; the result appears when it finishes.`)
          }
          // V8-07 (0.3.47): the cooldown joins the clampedNumber family — a
          // NaN used to disable the cooldown silently (`NaN > 0` is false,
          // exactly the repeated-model-call case this guards) and ±Infinity
          // made every resubmission cooldown-blocked forever.
          const cooldownMs = clampedNumber(config.maintainCooldownMs, 30_000, { min: 0 })
          const sinceLast = Date.now() - lastMaintainAt
          if (cooldownMs > 0 && sinceLast < cooldownMs) {
            const remaining = Math.ceil((cooldownMs - sinceLast) / 1000)
            // V10-08 (F-04): same contract as the in-flight refusal above —
            // cooldown-blocked returns kind:'error' (behavior contract change).
            return err(`Maintenance cooldown active (${remaining}s) — latest scan ${lastMaintainRunId}; re-running now would spend another model call.`)
          }
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          const subagents = ctx.get('subagents') as { start(kind: string, options: unknown): Promise<{ result: Promise<unknown> }> } | undefined
          if (!ioRegistry) return err('Evolution IO registry not mounted — maintenance scan unavailable.')
          if (!subagents) return err('Subagents service not mounted — maintenance scan unavailable.')
          // 0.3.14 (P2-1): set the in-flight flag BEFORE the first await
          // (enrichment is the slowest segment) so two re-triggers cannot both
          // pass the guard. 0.3.16 (S6.1, E-5/E-39): the flag set, the
          // enrichment and the scan are all INSIDE one try/finally — a thrown
          // enrichment (IO error, unreadable root) previously left the flag
          // non-zero forever (every later call: "already running", no log) and
          // skipped the cooldown update. A throw is translated to a structured
          // command error; finally resets the flag and the cooldown on success
          // AND failure.
          try {
            maintainInFlightSince = Date.now()
            const library = new SkillLibrary(resolveSkillsRoot({ root: config.skillsRoot }), ioRegistry.provider())
            const enrichment = await buildEnrichment(ctx, library)
            const outcome = await runMaintain(
              // E-55 (0.3.18): same-source model routing — the maintain subagent
              // reads evolutionPolicy.get().curatorModel exactly like the curator.
              // F-02: the tools registry rides along as a soft probe so
              // the orchestrator can degrade the subagent toolFilter when the
              // host bundle's maintenance_probe row is not mounted (same
              // `get(name)` accessor shape the platform registry exposes).
              {
                library,
                subagents,
                parent: invocation.agent,
                evolutionPolicy: { get: () => (ctx.get('evolutionPolicy') as { get(): { curatorModel?: string | undefined } } | undefined)?.get() },
                tools: { get: (name: string) => (ctx.get('tools') as { get(name: string): unknown } | undefined)?.get(name) },
                logger: { warn: (message: string) => { ctx.logger.warn(message) } },
              },
              {
                timeoutMs: runTimeoutMs,
                descriptions: () => enrichment.descriptions,
                supportFiles: () => enrichment.supportFiles,
                quality: () => enrichment.quality,
                protected: () => enrichment.protected,
                catalogInvalid: () => enrichment.catalogInvalid,
                usageObserved: () => enrichment.usageObservedValue,
              },
            )
            lastMaintainRunId = outcome.runId ?? ''
            if (!outcome.ok) return err(outcome.error ?? 'Maintenance scan failed.')
            const eventIo = ioRegistry.provider()
            const home = evolutionRoot()
            void appendEvolutionEvent(eventIo, eventsFile(home), {
              type: 'maintain',
              source: 'manual',
              runId: outcome.runId,
              verdict: outcome.verdict,
              // V10-09 (F-05): the count comes from the structured outcome
              // field (validated plan length) — the rendered text is
              // display-only and is no longer parsed.
              recommendations: outcome.recommendationCount,
            }).catch((error: unknown) => {
              ctx.logger.warn(`evolution-commands: failed to record maintain event: ${String(error)}`)
            })
            return ok(`Maintenance scan ${outcome.runId}:\n${outcome.text ?? ''}`)
          } catch (error) {
            return err(`Maintenance scan failed: ${error instanceof Error ? error.message : String(error)}`)
          } finally {
            maintainInFlightSince = 0
            lastMaintainAt = Date.now()
          }
        }
        if (/^maintain\b/.test(input)) {
          // 0.3.14 (P3-2): an input that STARTS with maintain but did not
          // match the grammar (unknown flags, stray args) was silently falling
          // into the help branch despite the branch comment claiming explicit
          // rejection. Reject it here.
          return err('Unknown maintain arguments: expected bare `maintain`, `maintain --timeout <ms>` or `maintain --timeout=<ms>` (a positive integer). Got: ' + input)
        }
        if (input === 'preset install') {
          // 0.3.14 (P1-1): the published install delivers the Evolution agent
          // preset package (ships agent.cordis.yml/preset.yml) as part of the
          // dependency closure, but nothing auto-copies it into
          // ~/.dsh/.agent-presets/evolution — this command performs that
          // delivery explicitly, idempotently and reversibly.
          // 0.3.15 (P1-1 follow-up): the agent-preset registry mounts the
          // composition file VERBATIM, so the delivered agent.cordis.yml must
          // be the runtime `standard` composition + the delta — 0.3.14 copied
          // the delta alone, which would produce an agent with only the delta
          // rows (no tools, no persona).
          const target = join(evolutionRoot(), '.agent-presets', 'evolution')
          try {
            const source = resolveAgentPresetDir(import.meta.url)
            const deltaPath = join(source, 'agent.cordis.yml')
            const presetPath = join(source, 'preset.yml')
            if (!existsSync(deltaPath) || !existsSync(presetPath)) return err(`Preset file missing from ${source} — is the dsh-evolution-agent-preset package installed?`)
            const registry = ctx.get('agentPresets') as { read(id: string): Promise<string> } | undefined
            if (!registry) return err('Agent preset registry not mounted — cannot compose the Evolution preset against the runtime standard.')
            const standard = await registry.read('standard')
            const composition = composePresetComposition(standard, readFileSync(deltaPath, 'utf8'))
            mkdirSync(target, { recursive: true })
            // S6.3 (E-40): commit both files atomically — each staged to a
            // sibling `<name>.tmp` then renamed into place, a pre-existing file
            // keeping a single `.bak`. A failure while staging either file (a
            // write that throws) removes the staged temps and leaves the
            // previous composition untouched, so a half-updated preset (one new
            // file, one old) is impossible.
            atomicWriteFiles(target, [
              { name: 'agent.cordis.yml', content: composition },
              { name: 'preset.yml', content: readFileSync(presetPath) },
            ])
            return ok(`Evolution agent preset installed to ${target} (runtime standard + delta). Restart the session switcher to select it.`)
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
          const planTail = /\s--plan\s+(\S+)\s*$/.exec(input) ?? null
          const planRunId = planTail?.[1] ?? undefined
          const rest = planTail ? input.slice(0, planTail.index) : input
          const match = /^restructure\s+(\S+)\s+"([^"]+)"\s+(\S+)$/.exec(rest)
          if (!match) return err('Usage: /evolution restructure <name> "<## heading>" <to_file>')
          const name = match[1] ?? ''
          const heading = match[2] ?? ''
          const toFile = match[3] ?? ''
          if (!toFile.startsWith('references/')) return err('to_file must live under references/ (log/detail destination).')
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          if (!ioRegistry) return err('Evolution IO registry not mounted — restructure unavailable.')
          // V8-08 (0.3.47): the command's restructure write joins the single
          // write-sink discipline — the skill-catalog cache invalidation
          // event fires like every other mutating construction point.
          // P2-18 (V10-03): the write-side library receives the configured
          // threat-scan exemption labels — the core-side constructor option
          // field is named `threatExemptLabels` (P2-18 core batch; the field
          // name is the linkage contract, keep in sync). Empty/omitted keeps
          // the strict scan unchanged.
          const library = new SkillLibrary(resolveSkillsRoot({ root: config.skillsRoot }), ioRegistry.provider(), undefined, (event) => { ctx.emit('evolution/skill-mutated', event) }, undefined, config.threatExemptLabels ?? [])
          const result = await library.restructure(name, [{ heading, toFile: toFile }], 'foreground')
          if (!result.ok) return err(result.message)
          // Same mutating observation surface as skill_manage performs for the
          // same action — the patch_count bump keeps the signals coherent.
          await (ctx.get('skillUsage') as { record?: (name: string, kind: 'patch') => Promise<void> } | undefined)?.record?.(name, 'patch')
          return ok(planRunId ? `${result.message}\n[audit] plan=${planRunId}` : result.message)
        }
        if (input === 'replay') {
          const replay = ctx.get('evolutionReplay') as { compare(): { report: string } } | undefined
          if (!replay) return err('Replay service not mounted.')
          return ok(replay.compare().report)
        }
        if (input === 'doctor' || input === 'doctor --json') {
          // WB2 (0.3.55): read-only self-check — install form, conflicts, env,
          // mounted services, pending count. `--json` feeds scripts.
          const report = await diagnose(ctx, { home: evolutionRoot() })
          if (input === 'doctor --json') return ok(JSON.stringify(report, null, 2))
          return ok(renderDoctorText(report))
        }
        return ok(`Evolution: memory, skills, review, curator — self-evolution status, approval and maintenance.\n${renderHelpText()}`)
      },
    }))
  })
}

interface CommandRuntimeLike {
  register(definition: unknown): () => void
}

/**
 * 0.3.14 (P1-1): locate the installed `dsh-evolution-agent-preset` package
 * (the delivery container for agent.cordis.yml/preset.yml). Resolution order:
 * npm-name sibling (published profile layout), dev-tree sibling (source/test
 * layout), then module resolution. The package dir name differs from the npm
 * name (`evolution-agent` vs `@lmzhen/dsh-evolution-agent-preset` — the rc.44
 * dir≠name trap), so BOTH sibling shapes are probed.
 */
function resolveAgentPresetDir(importMetaUrl: string): string {
  const dir = dirname(fileURLToPath(importMetaUrl))
  const siblingCandidate = join(dir, '..', 'dsh-evolution-agent-preset')
  const candidates = [siblingCandidate, join(dir, '..', '..', 'evolution-agent')]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'agent.cordis.yml')) && existsSync(join(candidate, 'preset.yml'))) return candidate
  }
  try {
    return dirname(createRequire(importMetaUrl).resolve('@deepseek-ai/dsh-evolution-agent-preset/package.json'))
  } catch {
    // S6.6-1 (E-64): last-resort sibling path, already probed by the loop above
    // and known not to hold both files — the caller's existsSync guard turns it
    // into a clean error. This replaces the old `candidates[0] ?? join(...)`
    // fallback whose `?? join(...)` right side was dead (siblingCandidate is
    // never null) and which re-derived an already-failed path.
    return siblingCandidate
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
  mtime: (path) => { try { return statSync(path).mtimeMs } catch { return null } },
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
        console.warn(`atomicWriteFiles: committed "${name}" but failed to refresh its .bak (${refreshError instanceof Error ? refreshError.message : String(refreshError)}); a later failed commit will recover to an OLDER generation`)
      }
    }
  } catch (error) {
    for (const { name } of writes) fs.rmSync(stage(name), { force: true, recursive: true })
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

interface CommandInvocation {
  rawInput?: string
  agent: { inject(message: unknown): void }
}
// 0.3.19 (W1.2): ApprovalLike is imported from evolution-approval (the one
// authoritative consumer shape) instead of this local view.

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
