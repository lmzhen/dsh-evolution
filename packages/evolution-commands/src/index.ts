/**
 * Human commands for the evolution family: /evolution learn|pending|curator|restore|consolidate.
 * @module @deepseek-ai/dsh-evolution-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendEvolutionEvent, buildLearnPrompt, eventsFile, parseFrontmatter, SkillLibrary, usageObserved, type EvolutionIoLike, type UsageMap } from '@deepseek-ai/dsh-evolution-core'
import { buildMaintainFacts, runMaintain, snapshotFromLibrary } from '@deepseek-ai/dsh-evolution-maintenance'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'evolution-commands'

export interface Config {
  /** Skill-tree root for maintain/restructure; empty uses skillsRoot().
   * Align with tool-skill-manage/skill-usage/evolution-skill-catalog rows (A7). */
  skillsRoot?: string | undefined
  /** Cooldown window for scan commands (ms) — misclick/rapid-trigger guard;
   * secondary calls inside the window return the previous runId instead of
   * spending another model call. Default 30s (0.3.5). NOTE: the window starts
   * AFTER a run settles (lastMaintainAt updates post-run) — it does NOT dedupe
   * in-flight runs, so the old 130s ">= timeout" rationale was a comment bug.
   * Transient (per-process). */
  maintainCooldownMs?: number | undefined
  /** Subagent deadline for one maintenance scan (ms). Default 120s; raise on
   * slow providers or very large skill libraries (0.3.3). */
  maintainTimeoutMs?: number | undefined
}

/** Enrichment maps shared by the full scan and the `--facts` preview (v12). */
interface Enrichment {
  descriptions: ReadonlyMap<string, string>
  supportFiles: ReadonlyMap<string, readonly string[]>
  quality: ReadonlyMap<string, number>
  usageObservedValue: boolean | undefined
}

async function buildEnrichment(ctx: Context, library: SkillLibrary): Promise<Enrichment> {
  // Enrichment hooks (011 §7, v11 P1-1): all four use existing APIs; a
  // missing service degrades to unknown (never a fabricated pass).
  const skillUsage = ctx.get('skillUsage') as { report?(): Promise<UsageMap> } | undefined
  const usageMap = skillUsage?.report ? await skillUsage.report() : undefined
  const usageObservedValue = usageMap ? usageObserved(usageMap) : undefined
  const descriptions = new Map<string, string>()
  const supportFiles = new Map<string, readonly string[]>()
  const quality = new Map<string, number>()
  for (const entry of await library.list()) {
    const body = await library.read(entry.name)
    if (body === null) continue
    const parsed = parseFrontmatter(body)
    const description = parsed?.frontmatter.description
    if (typeof description === 'string' && description.trim().length > 0) {
      descriptions.set(entry.name, description)
    }
    const files = await library.listSupportFiles(entry.name)
    if (files.length > 0) supportFiles.set(entry.name, files)
    const record = usageMap?.get(entry.name)
    if (typeof record?.quality_score === 'number') quality.set(entry.name, record.quality_score)
  }
  return { descriptions, supportFiles, quality, usageObservedValue }
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  const config = rawConfig
  let lastMaintainAt = 0
  let lastMaintainRunId = ''
  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: CommandRuntimeLike }).commands
    commands.register({
      name: 'evolution',
      description: 'Self-evolution status and approval controls',
      recordInput: false,
      // input declaration: the frontend treats a declared-input command as
      // args-tolerant (leading claim keeps the whole rest, spaces included) —
      // without it, multi-word subcommands (skills health, curator run, …)
      // submit as the bare `/evolution` and the handler only ever sees the
      // help branch (field report 2026-08-31; /goal is the working precedent).
      input: {
        hint: 'pending | approve <id> | reject <id> | curator run|pause|resume|status|report|scope | restore | consolidate <target> <sources...> | skill restore <name> | skills health | learn [request] | maintain [--timeout ms] | restructure <name> "<heading>" <to_file> | replay',
      },
      async handler(invocation: CommandInvocation) {
        const input = invocation.rawInput?.trim() ?? ''
        const ok = (text: string) => ({ kind: 'success' as const, text })
        const err = (text: string) => ({ kind: 'error' as const, text })
        const approval = (ctx.get('evolutionApproval') as ApprovalLike | undefined)
        if (input === 'pending') {
          const pending = approval ? await approval.list('pending') : []
          return ok(pending.length === 0 ? 'No pending evolution writes.' : pending.map(p => `${p.id}  ${p.kind}  ${p.summary}`).join('\n'))
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
          return ok(paused
            ? 'Curator automatic curation paused. Manual /evolution curator run is unaffected; resume with /evolution curator resume.'
            : 'Curator automatic curation resumed. The next scheduled pass waits one interval (first-run defer semantics).')
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
          const records = await curator.skills.listMutations()
          if (records.length === 0) return ok('No mutation records yet.')
          const recent = records.slice(-5).reverse().map(record => `${record.at.slice(0, 19)}  ${record.skillName}  ${record.action}  ${record.summary}`)
          return ok(`Mutations: ${records.length} recorded (recent 5):\n${recent.join('\n')}`)
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
            line('Protected (pinned / bundled / hub)', view.protected),
          ].join('\n'))
        }
        if (input === 'curator report') {
          const curator = ctx.get('evolutionCurator') as { latestReport(): Promise<{ runId: string; startedAt: string; archived: Array<{ name: string }>; failed: Array<{ name: string; reason: string }> } | null> } | undefined
          if (!curator) return err('Curator service not mounted.')
          const report = await curator.latestReport()
          if (!report) return ok('No curator report available.')
          const lines = [
            `runId=${report.runId}`,
            `startedAt=${report.startedAt}`,
            `archived=${report.archived.map(item => item.name).join(', ') || '(none)'}`,
            `failed=${report.failed.map(item => `${item.name}: ${item.reason}`).join(', ') || '(none)'}`,
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
            const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
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
          const library = new SkillLibrary(config.skillsRoot, ioRegistry.provider())
          const enrichment = await buildEnrichment(ctx, library)
          const snapshots = await snapshotFromLibrary(library, {
            descriptions: enrichment.descriptions,
            supportFiles: enrichment.supportFiles,
            quality: enrichment.quality,
          })
          const { facts } = buildMaintainFacts(snapshots, enrichment.usageObservedValue, undefined)
          return ok(`Maintenance facts (0-token preview):\n${facts}`)
        }
        const maintainArgs = /^maintain(?: --timeout (\d+))?\s*$/.exec(input)
        if (maintainArgs) {
          // User-command maintenance scan (design 011): deterministic facts +
          // one-shot subagent → validated plan display. No writes, no auto
          // execution; fail-closed when either dependency is missing. Scope
          // filtering is reserved (011 §3) — reject unknown args explicitly
          // instead of silently swallowing them. `--timeout <ms>` (0.3.4)
          // overrides the deadline for THIS run — no file edit, no restart.
          const runTimeoutMs = maintainArgs[1] ? Number(maintainArgs[1]) : (config.maintainTimeoutMs ?? 120_000)
          if (!Number.isSafeInteger(runTimeoutMs) || runTimeoutMs <= 0) {
            return err('Invalid --timeout value: expected a positive integer number of milliseconds (e.g. /evolution maintain --timeout 600000).')
          }
          const cooldownMs = config.maintainCooldownMs ?? 30_000
          const sinceLast = Date.now() - lastMaintainAt
          if (cooldownMs > 0 && sinceLast < cooldownMs) {
            const remaining = Math.ceil((cooldownMs - sinceLast) / 1000)
            return ok(`Maintenance cooldown active (${remaining}s) — latest scan ${lastMaintainRunId}; re-running now would spend another model call.`)
          }
          const ioRegistry = ctx.get('evolutionIo') as { provider(): EvolutionIoLike } | undefined
          const subagents = ctx.get('subagents') as { start(kind: string, options: unknown): Promise<{ result: Promise<unknown> }> } | undefined
          if (!ioRegistry) return err('Evolution IO registry not mounted — maintenance scan unavailable.')
          if (!subagents) return err('Subagents service not mounted — maintenance scan unavailable.')
          const library = new SkillLibrary(config.skillsRoot, ioRegistry.provider())
          const enrichment = await buildEnrichment(ctx, library)
          const outcome = await runMaintain(
            { library, subagents, parent: invocation.agent },
            {
              timeoutMs: runTimeoutMs,
              descriptions: () => enrichment.descriptions,
              supportFiles: () => enrichment.supportFiles,
              quality: () => enrichment.quality,
              usageObserved: () => enrichment.usageObservedValue,
            },
          )
          // Update the cooldown on success AND failure: repeated failing
          // scans must not refire either.
          lastMaintainAt = Date.now()
          lastMaintainRunId = outcome.runId ?? ''
          if (!outcome.ok) return err(outcome.error ?? 'Maintenance scan failed.')
          const eventIo = ioRegistry.provider()
          const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
          void appendEvolutionEvent(eventIo, eventsFile(home), {
            type: 'maintain',
            source: 'manual',
            runId: outcome.runId,
            verdict: outcome.verdict,
            recommendations: outcome.text?.split('\n').filter(line => line.startsWith('- [')).length ?? 0,
          }).catch((error: unknown) => {
            ctx.logger.warn(`evolution-commands: failed to record maintain event: ${String(error)}`)
          })
          return ok(`Maintenance scan ${outcome.runId}:\n${outcome.text ?? ''}`)
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
          const library = new SkillLibrary(config.skillsRoot, ioRegistry.provider())
          const result = await library.restructure(name, [{ heading, toFile: toFile }], 'foreground')
          if (!result.ok) return err(result.message)
          return ok(planRunId ? `${result.message}\n[audit] plan=${planRunId}` : result.message)
        }
        if (input === 'replay') {
          const replay = ctx.get('evolutionReplay') as { compare(): { report: string } } | undefined
          if (!replay) return err('Replay service not mounted.')
          return ok(replay.compare().report)
        }
        return ok('Evolution: memory, skills, review, curator. Use /evolution pending | approve <id> | reject <id> | curator run | curator status | curator pause | curator resume | curator report | curator scope | restore | consolidate <target> <source...> | skill restore <name> | skills health | learn [request] | maintain | restructure <name> "<heading>" <to_file> | replay.')
      },
    })
  })
}

interface CommandRuntimeLike {
  register(definition: unknown): () => void
}

interface CommandInvocation {
  rawInput?: string
  agent: { inject(message: unknown): void }
}

interface ApprovalLike {
  list(status: 'pending' | 'approved' | 'rejected'): Promise<Array<{ id: string; kind: string; summary: string }>>
  approve(id: string): Promise<{ ok: boolean; message: string }>
  reject(id: string): Promise<{ ok: boolean; message: string }>
}
