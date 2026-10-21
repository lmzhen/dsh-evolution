import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { screen as engineScreen, selectCandidates } from '@deepseek-ai/dsh-evolution-merge-engine'
import { createEngineScreening } from './adapters/engine-screen.ts'
import { authorityFrom, createSubagentChannel, DEFAULT_SKILL_LIMITS, evolutionHome, evolutionIoAdapter, newRunRegistry, newSkillLibrary, policyStageLimits, type EvolutionIoLike, type PolicyStageFields, type RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { loadMergeState, upsertRow } from './state.ts'
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
  mergeModelsRoot: z.string().default('').volatile(),
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
  const provide = (ctx as unknown as { provide?: (name: string, value: unknown) => void }).provide
  if (typeof provide === 'function') provide.call(ctx, 'evolutionMerge', mergeService)
  let source: MergeRouteSource | undefined
  registerHostRoutes(ctx, audit => makeMergeRoutes({ getSource: () => source }, audit))
  ctx.inject(['commands', 'evolutionIo'], (scope) => {
    const registry = scope.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
    if (registry === undefined) return
    const io = evolutionIoAdapter(() => registry.provider())
    const home = evolutionHome()
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
    const channel = subagentChannelAdapter(createSubagentChannel(ctx))
    const stage = new StageToolRegistry()
    const engineConfig = engineConfigFromEnv(params.mergeModelsRoot)
    const engineScreening = createEngineScreening({
        io, home, engine: { screen: engineScreen }, select: selectCandidates, cfg: engineConfig,
        async onSelection(selection) {
          const loaded = await loadMergeState(io, home)
          const at = new Date().toISOString()
          for (const skipped of selection.skipped) {
            if (loaded.state.rows.some(row => row.pairKey === skipped.pairKey)) continue
            const next = transition(undefined, { type: 'gate-keep', a: skipped.a, b: skipped.b, reason: skipped.reason, at })
            if (next.ok && next.row !== null) await upsertRow(io, home, () => Date.now(), next.row)
          }
        },
      })
    source = {
      rows() { return loadMergeState(io, home).then(loaded => loaded.state.rows) },
      run(id: string): Promise<RunRecord | undefined> { return Promise.resolve(runs.runs().find(record => record.id === id)) },
      runs() { return Promise.resolve(runs.runs()) },
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
      async cards(signal) {
        const listed = await skills.list({ withContent: true })
        if (signal.aborted) return []
        return Promise.all(listed.map(async item => {
          const probe = await skills.listSupportFiles(item.name)
          const paths = probe.kind === 'present' ? probe.value : []
          const files = await Promise.all(paths.map(async path => ({ path, content: await skills.readSupportFile(item.name, path) ?? '' })))
          return { name: item.name, description: item.description, body: item.content ?? '', files, protectedBy: item.protectedBy, protectionUnknown: item.protectionUnknown }
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
