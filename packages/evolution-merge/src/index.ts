import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { evolutionHome, evolutionIoAdapter, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { loadMergeState } from './state.ts'
import { makeMergeRoutes, type MergeRouteSource } from './merge-routes.ts'
import { createMergeCommand, createReadOnlyMergeService } from './merge-command.ts'

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
export * from './staged-tree.ts'
export * from './commit-assembly.ts'
export * from './commit-receipt.ts'
export * from './commit-execute.ts'
export * from './undo-merge.ts'
export * from './adapters/library.ts'
export * from './adapters/model.ts'
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

export const inject: string[] = []

export function apply(ctx: Context): void {
  configureMergePresentation(ctx as unknown as MergePresentationContext)
  let source: MergeRouteSource | undefined
  registerHostRoutes(ctx, audit => makeMergeRoutes({ getSource: () => source }, audit))
  ctx.inject(['commands', 'evolutionIo'], (scope) => {
    const registry = scope.get('evolutionIo') as { provider(name?: string): EvolutionIoLike } | undefined
    if (registry === undefined) return
    const io = evolutionIoAdapter(() => registry.provider())
    const home = evolutionHome()
    source = {
      async rows() { return (await loadMergeState(io, home)).state.rows },
      async run() { return undefined },
      async runs() { return [] },
      commands() { return ['merge status', 'merge pending', 'merge skipped'] },
    }
    const commands = scope.get('commands') as { register(definition: unknown): () => void } | undefined
    if (commands === undefined) return
    const command = createMergeCommand(createReadOnlyMergeService(io, home))
    scope.effect(() => commands.register(command), 'evolution-merge: command')
  })
}
