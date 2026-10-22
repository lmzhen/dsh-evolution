import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { screen as engineScreen } from '@deepseek-ai/dsh-evolution-merge-engine'
import { selectWithErrors } from './adapters/select.ts'
import { createEngineScreening, type EngineScreenPort } from './adapters/engine-screen.ts'
import { createEngineRunner, type LlmServiceLike } from './adapters/model-runner.ts'
import { authorityFrom, createSubagentChannel, DEFAULT_SKILL_LIMITS, evolutionHome, evolutionIoAdapter, newRunRegistry, newSkillLibrary, policyStageLimits, skillsRoot, type EvolutionIoLike, type PolicyStageFields, type RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { loadMergeState, upsertRow } from './state.ts'
import { cleanupExpiredStaging } from './staging.ts'
import { recoverCommitJournals } from './commit-recovery.ts'
import { readCommitReceipts } from './commit-receipt.ts'
import { transition } from './coordinator.ts'
import { makeMergeRoutes, type MergeRouteSource } from './merge-routes.ts'
import { createMergeCommand, runMergeCommand, type MergeCommandResult } from './merge-command.ts'
import { createMergeRuntime } from './runtime.ts'
import { resolveMergeParams } from './params.ts'
import { subagentChannelAdapter } from './adapters/channel.ts'
import { StageToolRegistry } from './stage-tool-registry.ts'
import type { StageToolContext } from './stage-tool.ts'
import { createMergeStageTool } from './merge-tool.ts'
import { supersedeMergeRuns } from './supersede.ts'

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

export function engineConfigFromEnv(configuredRoot?: string): Record<string, unknown> | undefined {
  const root = configuredRoot !== undefined && configuredRoot !== '' ? configuredRoot : process.env.SKILL_MERGE_MODELS_ROOT
  if (root === undefined || root === '') return undefined
  return {
    models_dir: '',
    offline: true,
    auto_provision: false,
    embed_backend: 'local',
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
export * from './status.ts'
export * from './skipped.ts'
export * from './read-commands.ts'
export * from './routes.ts'
export * from './merge-routes.ts'
export * from './merge-command.ts'
export * from './params.ts'
export * from './doctor.ts'
export * from './supersede.ts'
export * from './runtime.ts'

export const inject: string[] = []

export function apply(ctx: Context, rawConfig: Record<string, unknown> = {}): void {
  configureMergePresentation(ctx as unknown as MergePresentationContext)
  const params = resolveMergeParams(rawConfig)
  let mergeRun: ((rawInput: string, invocation?: { readonly agent?: unknown }) => Promise<MergeCommandResult>) | undefined
  const mergeService = {
    async run(rawInput: string, invocation?: { readonly agent?: unknown }): Promise<MergeCommandResult> {
      return mergeRun === undefined ? { ok: false, text: 'merge 未就绪：evolutionIo 尚未挂载' } : mergeRun(rawInput, invocation)
    },
  }
  const mergeContext = ctx as unknown as { provide?: (name: string, value: unknown) => void }
  if (typeof mergeContext.provide === 'function') {
    ;(mergeContext as unknown as { provide(name: string, value: unknown): void }).provide('evolutionMerge', mergeService)
  }
  let source: MergeRouteSource | undefined
  registerHostRoutes(ctx, audit => makeMergeRoutes({ getSource: () => source }, audit))
  ctx.inject(['commands', 'evolutionIo'], (scope) => {
    const registry = scope.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
    if (registry === undefined) return
    const io = evolutionIoAdapter(() => registry.provider())
    const home = evolutionHome()
    void loadMergeState(io, home).then(loaded => cleanupExpiredStaging(io, home, Date.now(), new Set(loaded.state.rows.map(row => row.runId).filter((id): id is string => id !== undefined)))).catch((error: unknown) => { ctx.logger.warn('merge staging cleanup failed: ' + (error instanceof Error ? error.message : String(error))) })
    const runs = newRunRegistry({ io, home, warn: (message) => { ctx.logger.warn(message) } })
    void runs.load()
    ctx.effect(() => {
      const host = ctx as unknown as { on(name: string, listener: (event: { action?: string }) => void): () => void }
      if (typeof host.on !== 'function') return () => {}
      return host.on('evolution/skill-mutated', (event) => {
        if (event.action === 'restore') void supersedeMergeRuns(runs)
      })
    }, 'evolution-merge: restore supersede')
    const policySnapshot = (ctx as unknown as { get(name: string): unknown }).get('evolutionPolicy') as { get?(): PolicyStageFields } | undefined
    const skills = newSkillLibrary({
      io, ctx, authority: authorityFrom({ origin: 'subagent' }),
      limits: { ...DEFAULT_SKILL_LIMITS, ...policyStageLimits(policySnapshot?.get?.()) },
    })
    const mergeSkillsRoot = (skills as unknown as { root?: string }).root ?? skillsRoot()
    void recoverCommitJournals(io, home, Date.now(), mergeSkillsRoot, async (name) => {
      const result = await skills.restoreFromArchive(name)
      return result.ok
    }, (runId) => {
      const run = runs.find(runId)
      return run !== undefined && run.state === 'running'
    }).then((reports) => { if (reports.length > 0) ctx.logger.info('merge commit recovery: ' + reports.map(report => report.runId + '=' + report.action).join(', ')) }).catch((error: unknown) => { ctx.logger.warn('merge commit recovery failed: ' + (error instanceof Error ? error.message : String(error))) })
    const channel = subagentChannelAdapter(createSubagentChannel(ctx))
    const stage = new StageToolRegistry()
    const engineConfig = engineConfigFromEnv(params.mergeModelsRoot)
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
      cfg: { ...(engineConfig ?? {}), judge: 'deepseek' },
      ...(runner === undefined ? {} : { runner }),
      async onSelection(selection) {
        const loaded = await loadMergeState(io, home)
        const at = new Date().toISOString()
        for (const skipped of selection.skipped) {
          if (loaded.state.rows.some(row => row.pairKey === skipped.pairKey)) continue
          const next = transition(undefined, {
            type: 'gate-keep', a: skipped.a, b: skipped.b,
            ...(skipped.reason === undefined ? {} : { reason: skipped.reason }), at,
          })
          if (next.ok && next.row !== null) await upsertRow(io, home, () => Date.now(), next.row)
        }
      },
    })
    source = {
      rows() { return loadMergeState(io, home).then(loaded => loaded.state.rows) },
      run(id: string): Promise<RunRecord | undefined> { return Promise.resolve(runs.runs().find(record => record.id === id)) },
      runs() { return Promise.resolve(runs.runs()) },
      async body(id: string, side: 'a' | 'b'): Promise<string | null> {
        const row = (await loadMergeState(io, home)).state.rows.find(item => item.id === id)
        if (row === undefined) return null
        return await skills.read(side === 'a' ? row.a : row.b)
      },
      async history() {
        const receipts = await readCommitReceipts(io, home)
        const items = new Map<string, { name: string; kind: 'merged' | 'other'; reason: string; lastVersion: number; archivedAt: string; sourceRunId?: string }>()
        for (const receipt of receipts) {
          for (const source of receipt.sources) {
            const key = source + ':' + receipt.runId
            if (items.has(key)) continue
            items.set(key, { name: source, kind: 'merged', reason: 'Merged into ' + receipt.target, lastVersion: 1, archivedAt: new Date(receipt.at).toISOString(), sourceRunId: receipt.runId })
          }
        }
        const archived = await (skills as unknown as { archivedNames?: () => Promise<string[] | null> }).archivedNames?.() ?? []
        const seen = new Set([...items.values()].map(item => item.name))
        for (const name of archived) {
          if (seen.has(name)) continue
          items.set('archived:' + name, { name, kind: 'other', reason: 'archived', lastVersion: 1, archivedAt: new Date(Date.now()).toISOString() })
        }
        return [...items.values()]
      },
      approval() { return params.mergeApproval },
      commands() {
        return ['merge scan', 'merge doctor', 'merge status', 'merge pending', 'merge skipped', 'merge report', 'merge runs', 'merge cancel']
      },
    }
    const commands = scope.get('commands') as { register(definition: unknown): () => void } | undefined
    if (commands === undefined) return
    const runtime = createMergeRuntime({
      io, home, registry: runs, skills, now: () => Date.now(), params, platformWrite: true,
      channel, parent: undefined, allow: ['merge_stage'], timeoutMinutes: params.mergeRunTimeoutMinutes,
      isBlocked: (name) => {
        const curator = (ctx as unknown as { get(key: string): unknown }).get('evolutionCurator') as { gates?: { isBlocked?: (name: string) => boolean } } | undefined
        return curator?.gates?.isBlocked?.(name) === true
      },
      async cards(signal) {
        const listed = await skills.list({ withContent: true })
        if (signal.aborted) return []
        return Promise.all(listed.map(async (item) => {
          const probe = await skills.listSupportFiles(item.name)
          const paths = probe.kind === 'present' ? probe.value : []
          const files = await Promise.all(paths.map(async path => ({ path, content: await skills.readSupportFile(item.name, path) ?? '' })))
          return { name: item.name, description: item.description, body: item.content ?? '', files, protectedBy: item.protectedBy, protectionUnknown: item.protectionUnknown, managed: item.managed }
        }))
      },
      screeningForRun: engineScreening,
      stage: {
        bind: (context: StageToolContext) => { stage.bind(context.childId, context) },
        unbind: (childId) => { stage.unbind(childId) },
      },
    })
    mergeRun = (rawInput, invocation) => runMergeCommand(runtime, rawInput, invocation)
    const command = createMergeCommand(runtime)
    scope.effect(() => commands.register(command), 'evolution-merge: command')
    ctx.inject(['tools'], (toolScope) => {
      const tools = toolScope.get('tools') as { register(definition: unknown): () => void } | undefined
      if (tools === undefined) return
      const tool = createMergeStageTool(io, home, exec => stage.resolve(exec))
      toolScope.effect(() => tools.register(tool), 'evolution-merge: merge_stage')
    })
    scope.effect(() => () => { runs.cancelAll() }, 'evolution-merge: runs')
  })
}
