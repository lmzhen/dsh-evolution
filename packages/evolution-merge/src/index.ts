import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { authorityFrom, createSubagentChannel, evolutionHome, evolutionIoAdapter, newRunRegistry, newSkillLibrary, type EvolutionIoLike, type RunRecord } from '@deepseek-ai/dsh-evolution-core'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { loadMergeState } from './state.ts'
import { makeMergeRoutes, type MergeRouteSource } from './merge-routes.ts'
import { createMergeCommand } from './merge-command.ts'
import { createMergeRuntime } from './runtime.ts'
import { resolveMergeParams } from './params.ts'
import { lexicalCandidates } from './screening.ts'
import { subagentChannelAdapter } from './adapters/channel.ts'
import { StageToolRegistry } from './stage-tool-registry.ts'
import { createMergeStageTool } from './merge-tool.ts'

/** E3 knobs are volatile (user layer); the E2 pair timeout is deployment-only. */
export const Config = z.object({
  mergeApproval: z.boolean().default(false).volatile(),
  mergeSkippedTtlDays: z.number().min(0).default(0).volatile(),
  mergeRunTimeoutMinutes: z.number().min(0).default(0).volatile(),
  mergePairTimeoutMinutes: z.number().min(1).default(15),
})

export interface MergePresentationContext {
  inject(names: string[], run: (scope: { effect(run: () => () => void, label?: string): unknown; settings?: { configure?: (presentation: { auto?: boolean }, owner?: unknown) => unknown } }) => void): void
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
export * from './adapters/model.ts'
export * from './adapters/channel.ts'
export * from './run-shell.ts'
export * from './scan-run.ts'
export * from './pending-actions.ts'
export * from './scan-command.ts'
export * from './round2-outcome.ts'
export * from './approve-command.ts'
export * from './pair-command.ts'
export * from './resume-command.ts'
export * from './screening.ts'
export * from './propose.ts'
export * from './ladder.ts'
export * from './gate-cache.ts'
export * from './gate-filter.ts'
export * from './screening-port.ts'
export * from './decision.ts'
export * from './prompts.ts'
export * from './channel-port.ts'
export * from './authoring-flow.ts'
export * from './merge-tool.ts'
export * from './commands.ts'
export * from './scan-ports.ts'
export * from './new-child-authoring.ts'
export * from './status.ts'
export * from './read-commands.ts'
export * from './routes.ts'
export * from './merge-routes.ts'
export * from './merge-command.ts'
export * from './params.ts'
export * from './doctor.ts'
export * from './runtime.ts'

export const inject: string[] = []

export function apply(ctx: Context, rawConfig: Record<string, unknown> = {}): void {
  configureMergePresentation(ctx as unknown as MergePresentationContext)
  const params = resolveMergeParams(rawConfig)
  let source: MergeRouteSource | undefined
  registerHostRoutes(ctx, audit => makeMergeRoutes({ getSource: () => source }, audit))
  ctx.inject(['commands', 'evolutionIo'], (scope) => {
    const registry = scope.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
    if (registry === undefined) return
    const io = evolutionIoAdapter(() => registry.provider())
    const home = evolutionHome()
    const runs = newRunRegistry({ io, home, warn: message => { ctx.logger.warn(message) } })
    void runs.load()
    const skills = newSkillLibrary({ io, authority: authorityFrom({ origin: 'subagent' }) })
    const channel = subagentChannelAdapter(createSubagentChannel(ctx))
    const stage = new StageToolRegistry()
    source = {
      async rows() { return (await loadMergeState(io, home)).state.rows },
      async run(id: string): Promise<RunRecord | undefined> { return runs.runs().find(record => record.id === id) },
      async runs() { return runs.runs() },
      commands() { return ['merge scan', 'merge status', 'merge pending', 'merge skipped'] },
    }
    const commands = scope.get('commands') as { register(definition: unknown): () => void } | undefined
    if (commands === undefined) return
    const runtime = createMergeRuntime({
      io, home, registry: runs, skills, now: () => Date.now(), params, platformWrite: true,
      channel, parent: undefined, allow: ['merge_stage'], timeoutMinutes: params.mergeRunTimeoutMinutes,
      async cards(signal) {
        const listed = await skills.list({ withContent: true })
        if (signal.aborted) return []
        return listed.map(item => ({ name: item.name, description: item.description, body: item.content ?? '' }))
      },
      async screening(cards) { return lexicalCandidates(cards).candidates },
      stage: { bind: context => stage.bind(context.childId, context), unbind: childId => stage.unbind(childId) },
    })
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
