import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { screen as engineScreen } from '@deepseek-ai/dsh-evolution-merge-engine'
import { selectWithErrors } from './adapters/select.ts'
import { createEngineScreening, type EngineScreenPort } from './adapters/engine-screen.ts'
import { createEngineRunner, type LlmServiceLike } from './adapters/model-runner.ts'
import { authorityFrom, createSubagentChannel, evolutionHome, evolutionIoAdapter, newRunRegistry, newSkillLibrary, reportsSweepLockTarget, sweepReports, transactIo, type EvolutionIoLike, type PolicyStageFields, type SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { loadMergeState } from './state.ts'
import { pairLedger, normalizePairLedger } from './domain/pair-ledger.ts'
import { legacyToV3 } from './domain/row-v3-bridge.ts'
import { readV4Readiness } from './domain/schema4.ts'
import { readMergeSnapshot } from './domain/merge-snapshot.ts'
import type { HistoryItem } from './domain/merge-snapshot.ts'
import { readCommitReceipts } from './commit-receipt.ts'
import { UnitTransactions, skillLibraryUnitBackend } from '@deepseek-ai/dsh-evolution-core'
import { targetClaimUnitPort } from './unit-claim.ts'
import { resolveLimitsSnapshot } from './domain/merge-limits.ts'
import { resolveEngineInput } from './domain/engine-input.ts'
import { readReconcileReport, reconcileMergeState } from './domain/reconcile.ts'
import { readRunMeta, writeRunMeta } from './domain/run-coordinator.ts'
import { liveRowFactsOf } from './domain/live-facts.ts'
import { filterSelection } from './domain/selection-policy.ts'
import type { BodyRef } from './domain/merge-snapshot.ts'
import { cleanupStage } from './domain/stage-aggregate.ts'
import { buildDoctorView } from './surface/merge-view.ts'
import { mergeDoctorFact, type MergeDoctorFact } from './doctor.ts'
import { commandError, formatMergeError } from './domain/errors.ts'
import { resolveBody } from './surface/body.ts'
import { ensureMergeStateReady } from './domain/state-bootstrap.ts'
import { recoverCommitUnits } from './recovery-coordinator.ts'
import { pairKey, rowIdOf } from './contracts.ts'
import { makeMergeRoutes, type MergeRouteSource } from './merge-routes.ts'
import { createMergeCommand, runMergeCommand, type MergeCommandResult } from './merge-command.ts'
import { createMergeRuntime } from './runtime.ts'
import { resolveMergeParams } from './params.ts'
import { subagentChannelAdapter } from './adapters/channel.ts'
import { StageToolRegistry } from './stage-tool-registry.ts'
import type { StageToolContext } from './stage-tool.ts'
import { createMergeStageTool } from './merge-tool.ts'
import { supersedeMergeRuns } from './supersede.ts'
import type { SkillCard } from './skill-card.ts'

/**
 * One library read used by both the runtime card port and the read-time convergence
 * facts. Read-only: the snapshot/doctor consumers must never write.
 * @param skills - the mounted skill store.
 * @returns every live skill as a merge card (body + support files).
 */
async function readSkillCards(skills: SkillLibrary): Promise<readonly SkillCard[]> {
  const listed = await skills.list({ withContent: true })
  return await Promise.all(listed.map(async (item) => {
    const probe = await skills.listSupportFiles(item.name)
    const paths = probe.kind === 'present' ? probe.value : []
    const files = await Promise.all(paths.map(async path => ({ path, content: await skills.readSupportFile(item.name, path) ?? '' })))
    return { name: item.name, description: item.description, body: item.content ?? '', files, protectedBy: item.protectedBy, protectionUnknown: item.protectionUnknown, managed: item.managed }
  }))
}

/** E3 knobs are volatile (user layer); the E2 pair timeout is deployment-only. */
export const Config = z.object({
  mergeApproval: z.boolean().default(false).volatile(),
  mergeSkippedTtlDays: z.number().min(0).default(0).volatile(),
  mergeRunTimeoutMinutes: z.number().min(0).default(0).volatile(),
  mergePairTimeoutMinutes: z.number().min(1).default(15),
  mergeModelsRoot: z.string().default(''),
})

export interface MergePresentationScope {
  effect(run: () => () => void, label?: string): unknown
  settings?: { configure?: (presentation: { auto?: boolean }, owner?: unknown) => unknown }
}

export interface EngineModelConfig {
  readonly embedder_model: string
  readonly embedder_model_last: string
}

export function engineConfigFromRoot(configuredRoot?: string): EngineModelConfig | undefined {
  const root = configuredRoot?.trim() ?? ''
  if (root === '') return undefined
  return {
    embedder_model: join(root, 'potion-multilingual-128M-int8'),
    embedder_model_last: join(root, 'potion-multilingual-128M-pca64-int8'),
  }
}

export interface MergePresentationContext {
  inject(names: string[], run: (scope: MergePresentationScope) => void): void
  readonly fiber?: unknown
}

/** Suppress the platform auto form; the registry renders the merge card instead. */
export function configureMergePresentation(ctx: MergePresentationContext): void {
  ctx.inject(['settings'], (scope) => {
    const settings = scope.settings
    if (typeof settings?.configure !== 'function') return
    const disposer = settings.configure({ auto: false }, ctx.fiber)
    if (typeof disposer === 'function') scope.effect(() => disposer as () => void, 'evolution-merge: settings presentation')
  })
}

export * from './contracts.ts'
export * from './skill-card.ts'
export * from './state.ts'
export * from './coordinator.ts'
export * from './report.ts'
export * from './staging.ts'
export * from './staging-files.ts'
export * from './rules.ts'
export * from './commit-plan.ts'
export * from './stage-tool.ts'
export * from './stage-tool-registry.ts'
export * from './staged-tree.ts'
export * from './commit-assembly.ts'
export * from './commit-receipt.ts'
export * from './commit-execute.ts'
export * from './undo-merge.ts'
export * from './adapters/library.ts'
export * from './adapters/model-runner.ts'
export * from './adapters/channel.ts'
export * from './adapters/engine-screen.ts'
export * from './adapters/undo.ts'
export * from './run-shell.ts'
export * from './scan-run.ts'
export * from './pending-actions.ts'
export * from './scan-command.ts'
export * from './round2-outcome.ts'
export * from './approve-command.ts'
export * from './pair-command.ts'
export * from './resume-command.ts'
export * from './decision.ts'
export * from './prompts.ts'
export * from './channel-port.ts'
export * from './authoring-flow.ts'
export * from './merge-tool.ts'
export * from './commands.ts'
export * from './scan-ports.ts'
export * from './new-child-authoring.ts'
export * from './domain/authoring-manifest.ts'
export * from './domain/live-facts.ts'
export * from './status.ts'
export * from './skipped.ts'
export * from './read-commands.ts'
export * from './merge-routes.ts'
export * from './merge-command.ts'
export * from './params.ts'
export * from './doctor.ts'
export * from './supersede.ts'
export * from './runtime.ts'

/** Not-yet-mounted command face: three lines so a script can read code/hint/next. */
function formatUnreadyError(): string {
  return formatMergeError(commandError('merge', 'merge-not-ready', 'evolutionIo 尚未挂载', '等待插件加载完成后重试；运行 /evolution doctor 查看挂载状态'))
}

export const inject: string[] = []

export function apply(ctx: Context, rawConfig: Record<string, unknown> = {}): void {
  configureMergePresentation(ctx as unknown as MergePresentationContext)
  let params = resolveMergeParams(rawConfig)
  let mergeRun: ((rawInput: string, invocation?: { readonly agent?: unknown }) => Promise<MergeCommandResult>) | undefined
  let source: MergeRouteSource | undefined
  let doctorFact: (() => Promise<MergeDoctorFact>) | undefined
  const mergeService = {
    async run(rawInput: string, invocation?: { readonly agent?: unknown }): Promise<MergeCommandResult> {
      return mergeRun === undefined ? { ok: false, text: formatUnreadyError() } : mergeRun(rawInput, invocation)
    },
    /** Global-doctor consumer: merges buildDoctorView over the shared snapshot with the reconcile report. */
    async doctorFact(): Promise<MergeDoctorFact> {
      if (doctorFact === undefined) return { status: 'unknown', detail: '合并服务尚未完成挂载', remedy: '稍后重新运行 /evolution doctor' }
      return await doctorFact()
    },
  }
  const mergeContext = ctx as unknown as { provide?: (name: string, value: unknown) => void }
  if (typeof mergeContext.provide === 'function') {
    ;(mergeContext as unknown as { provide(name: string, value: unknown): void }).provide('evolutionMerge', mergeService)
  }
  registerHostRoutes(ctx, audit => makeMergeRoutes({ getSource: () => source }, audit))
  ctx.inject(['commands', 'evolutionIo'], (scope) => {
    const registry = scope.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
    if (registry === undefined) return
    const io = evolutionIoAdapter(() => registry.provider())
    const home = evolutionHome()
    const ready = (async () => {
      const v4 = await readV4Readiness(io, home)
      if (v4.ok) {
        const loaded = await loadMergeState(io, home)
        return { ok: true as const, schema: 3 as const, migrated: false, state: { schemaVersion: 3 as const, rows: loaded.state.rows.map(legacyToV3).filter((row): row is NonNullable<typeof row> => row !== null) }, quarantine: [], report: null }
      }
      const state = await ensureMergeStateReady(io, home)
      if (!state.ok) return v4.code === 'merge-state-forward-only' || v4.code === 'merge-state-needs-repair' ? { ok: false as const, code: v4.code, message: v4.message } : state
      const normalized = await normalizePairLedger(io, home)
      return normalized.ok ? state : { ok: false as const, code: 'merge-state-needs-repair' as const, message: normalized.message ?? 'v4 normalize failed' }
    })().catch(error => ({ ok: false as const, code: 'merge-state-migration-blocked' as const, message: error instanceof Error ? error.message : String(error) }))
    const runs = newRunRegistry({ io, home, warn: (message) => { ctx.logger.warn(message) } })
    ctx.effect(() => {
      const host = ctx as unknown as { on(name: string, listener: (event: { action?: string }) => void): () => void }
      if (typeof host.on !== 'function') return () => {}
      return host.on('evolution/skill-mutated', (event) => {
        if (event.action === 'restore') void supersedeMergeRuns(runs)
      })
    }, 'evolution-merge: restore supersede')
    const policySnapshot = (ctx as unknown as { get(name: string): unknown }).get('evolutionPolicy') as { get?(): PolicyStageFields } | undefined
    const limitsSnapshot = resolveLimitsSnapshot(policySnapshot?.get?.())
    const hostApproval = (ctx as unknown as { get(name: string): unknown }).get('evolutionApproval') as { readonly platformWrite?: boolean } | undefined
    const platformWrite = typeof hostApproval?.platformWrite === 'boolean' ? hostApproval.platformWrite : (params.platformWrite ?? false)
    params = { ...params, limitsSnapshot, platformWrite }
    const skills = newSkillLibrary({
      io, ctx, authority: authorityFrom({ origin: 'subagent' }),
      limits: limitsSnapshot.skillLimits,
    })
    void ready.then(value => {
      if (!value.ok) { ctx.logger.warn('merge state is not ready: ' + value.code + ': ' + value.message); return }
      const unit = new UnitTransactions({ io, home, backend: skillLibraryUnitBackend(skills), claim: targetClaimUnitPort(io, home, () => Date.now()), now: () => Date.now() })
      const cards = async () => await readSkillCards(skills)
      void (async () => {
        // NFR-05: load the shared run index BEFORE recovery. Recovery settles through the
        // registry's controlled orphan upgrade (settleRecovered), which is the only way a
        // committed unit can turn an orphan-stamped run back into succeeded.
        const loaded = await runs.load()
        if (!loaded.ok) ctx.logger.warn('merge run index: ' + (loaded.note ?? 'unreadable'))
        const reports = await recoverCommitUnits({ io, home, unit, now: () => Date.now(), isActive: () => false, runs })
        if (reports.length > 0) ctx.logger.info('merge unit recovery: ' + reports.map(report => report.runId + '/' + report.unitId + '=' + report.action).join(', '))
        const v4 = await readV4Readiness(io, home)
        if (v4.ok) {
          const cleanup = await cleanupStage(io, home, Date.now(), new Map(v4.state.rows.map(row => [row.id, { state: row.state }])))
          if (cleanup.expired.length > 0 || cleanup.removed.length > 0) ctx.logger.info('merge stage cleanup: ' + String(cleanup.expired.length) + ' expired, ' + String(cleanup.removed.length) + ' removed, ' + String(cleanup.orphans.length) + ' orphan(s)')
          // Reconcile is the one row-state convergence writer; startup simply invokes it.
          // A live library is only supplied when it is non-empty (an empty/unreadable list
          // must never authorize source-gone removal).
          const pending = v4.state.rows.some(row => row.state === 'pending')
          const library = pending ? await cards().catch(() => []) : []
          const live = library.length === 0 ? undefined : liveRowFactsOf(library)
          const reconciled = await reconcileMergeState({ io, home, now: () => Date.now(), ttlDays: params.mergeSkippedTtlDays, ...(live === undefined ? {} : { live }) })
          if (reconciled.actions.length > 0) ctx.logger?.info?.('merge reconcile: ' + String(reconciled.actions.length) + ' action(s)')
          await transactIo(io, reportsSweepLockTarget(), async () => {
            await sweepReports({ io, dir: join(home, 'reports'), buckets: [{ prefix: 'merge-', keep: 20 }], owner: 'evolution-merge', warn: message => ctx.logger.warn(message) })
            return null
          })
        }
      })().catch((error: unknown) => { ctx.logger.warn('merge recovery failed: ' + (error instanceof Error ? error.message : String(error))) })
    }).catch((error: unknown) => { ctx.logger.warn('merge state readiness failed: ' + (error instanceof Error ? error.message : String(error))) })
    const channel = subagentChannelAdapter(createSubagentChannel(ctx))
    const stage = new StageToolRegistry()
    const engineInput = resolveEngineInput({ modelsRoot: params.mergeModelsRoot })
    const engineConfig = engineConfigFromRoot(engineInput.modelsRoot)
    const llm = (ctx as unknown as { get(name: string): unknown }).get('llm') as LlmServiceLike | undefined
    const defaultModel = (ctx as unknown as { get(name: string): unknown }).get('agentDefaultModel') as { currentSelection(): { provider: string; model: string } } | undefined
    const runner = llm === undefined || defaultModel === undefined
      ? undefined
      : createEngineRunner(llm, () => defaultModel.currentSelection())
    const engineScreening = createEngineScreening({
      io,
      home,
      engine: { screen: engineScreen as unknown as EngineScreenPort['screen'] },
      select: selectWithErrors,
      cfg: { ...engineConfig, judge: runner === undefined ? 'stub' : 'deepseek', ...(engineInput.maxTokens === 0 ? {} : { maxTokens: engineInput.maxTokens }), ...(engineInput.timeoutMs === 0 ? {} : { timeoutMs: engineInput.timeoutMs }) },
      ...(runner === undefined ? {} : { runner }),
      async onSelection(selection, _runId, cards) {
        try {
        const byName = new Map(cards.map(card => [card.name, card]))
        const filtered = filterSelection(selection, name => byName.get(name)?.managed === true, name => { const card = byName.get(name); return card?.protectionUnknown === true || card?.protectedBy != null })
        const loaded = await loadMergeState(io, home)
        const at = new Date().toISOString()
        for (const skipped of filtered.skipped) {
          if (loaded.state.rows.some(row => row.pairKey === skipped.pairKey)) continue
          const key = pairKey(skipped.a, skipped.b)
          await pairLedger(io, home).transact(tx => tx.createSkipped({
            id: rowIdOf(key), pairKey: key, a: skipped.a, b: skipped.b, version: 0,
            createdAt: at, updatedAt: at, origin: 'agent',
            state: 'skipped', reason: skipped.reason ?? 'gate-keep', attempts: 0,
          }).ok)
        }
        } catch (error) {
          const meta = await readRunMeta(io, home, _runId)
          if (meta !== null) await writeRunMeta(io, home, { ...meta, degraded: true, updatedAt: new Date().toISOString() })
          ctx.logger.warn('merge selection reportOnly write failed (degraded): ' + (error instanceof Error ? error.message : String(error)))
        }
      },
    })
    source = {
      async snapshot() {
        return await readMergeSnapshot({ io, home, runs: runs.runs('merge'), approval: params.mergeApproval, platformWrite, live: async () => liveRowFactsOf(await readSkillCards(skills)), history: async (): Promise<readonly HistoryItem[]> => {
          const items = new Map<string, HistoryItem>()
          const receipts = [...await readCommitReceipts(io, home)].sort((a, b) => a.at - b.at)
          const generationOf = new Map(receipts.map((receipt, index) => [receipt.runId, index + 1]))
          for (const receipt of receipts) for (const name of receipt.sources) items.set(name, { name, kind: 'merged', reason: '已合并进「' + receipt.target + '」，最后一版保留可查。', reasonCode: 'merged', lastVersion: 1, archivedAt: receipt.at, sourceRunId: receipt.runId, runId: receipt.runId, absorbedInto: receipt.target, generation: generationOf.get(receipt.runId) ?? 1 })
          const archived = await (skills as unknown as { archivedNames?: () => Promise<string[] | null> }).archivedNames?.() ?? []
          const reasonOf = (skills as unknown as { readArchiveReason?: (name: string) => Promise<string | null> }).readArchiveReason
          for (const name of archived) {
            if (items.has(name)) continue
            const rawReason = reasonOf === undefined ? null : await reasonOf.call(skills, name).catch(() => null)
            const lower = (rawReason ?? '').toLowerCase()
            const kind = lower.includes('split') ? 'split' as const : lower.includes('delet') || lower.includes('remove') ? 'deleted' as const : 'other' as const
            items.set(name, { name, kind, reason: rawReason ?? '技能已归档，最后一版保留可查。', reasonCode: kind === 'other' ? 'archived' : kind, lastVersion: 1, archivedAt: Date.now() })
          }
          const out: HistoryItem[] = []
          for (const item of items.values()) {
            const versions = await skills.listVersions(item.name).catch(() => [])
            const lastVersion = versions.at(-1)?.v ?? item.lastVersion
            out.push({ ...item, lastVersion, generation: item.generation ?? lastVersion })
          }
          return out
        } })
      },
      async bodyRef(ref: BodyRef) { return await resolveBody(io, home, ref, async () => ref.side === 'archive' ? await skills.readArchived(ref.name) : await skills.read(ref.name)) },
      approval() { return params.mergeApproval },
      readiness() { return ready },
      commands() {
        return ['merge scan', 'merge doctor', 'merge status', 'merge pending', 'merge skipped', 'merge report', 'merge runs', 'merge cancel', 'merge reconcile']
      },
    }
    doctorFact = async () => {
      const current = source
      if (current?.snapshot === undefined) return { status: 'unknown', detail: '合并快照来源尚未挂载', remedy: '稍后重新运行 /evolution doctor' }
      const view = buildDoctorView(await current.snapshot())
      return mergeDoctorFact(view, await readReconcileReport(io, home))
    }
    const commands = scope.get('commands') as { register(definition: unknown): () => void } | undefined
    if (commands === undefined) return
    const runtime = createMergeRuntime({
      io, home, registry: runs, skills, now: () => Date.now(), params, platformWrite,
      channel, parent: undefined, allow: ['merge_stage'], timeoutMinutes: params.mergeRunTimeoutMinutes,
      isBlocked: async (name) => {
        const curator = (ctx as unknown as { get(key: string): unknown }).get('evolutionCurator') as { isBlocked?: (name: string) => Promise<boolean> } | undefined
        return (await curator?.isBlocked?.(name)) === true
      },
      isOwnerActive: (runId) => {
        const run = runs.find(runId)
        return run !== undefined && run.state === 'running'
      },
      async cards(signal) {
        if (signal.aborted) return []
        return await readSkillCards(skills)
      },
      screeningForRun: engineScreening,
      stage: {
        bind: (context: StageToolContext) => { stage.bind(context.childId, context) },
        unbind: (childId) => { stage.unbind(childId) },
      },
    })
    mergeRun = async (rawInput, invocation) => {
      const state = await ready
      // These verbs answer usefully on a blocked state; reconcile reports the block without writing.
      const allowedWhenBlocked = /(?:^|\s)(doctor|status|pending|skipped|report|runs|reconcile)(?:\s|$)/.test(rawInput)
      if (!state.ok && !allowedWhenBlocked) return { ok: false, text: formatMergeError(commandError('merge', state.code, state.message, '先修复合并状态（/evolution merge doctor），再重试')) }
      return runMergeCommand(runtime, rawInput, invocation)
    }
    const command = createMergeCommand(runtime)
    if (command !== null) scope.effect(() => commands.register(command), 'evolution-merge: command')
    ctx.inject(['tools'], (toolScope) => {
      const tools = toolScope.get('tools') as { register(definition: unknown): () => void } | undefined
      if (tools === undefined) return
      const tool = createMergeStageTool(io, home, exec => stage.resolve(exec), exec => stage.snapshot(exec))
      toolScope.effect(() => tools.register(tool), 'evolution-merge: merge_stage')
    })
    scope.effect(() => () => { runs.cancelAll() }, 'evolution-merge: runs')
  })
}
