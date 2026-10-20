/**
 * Host plugin entry: mount the read-only route surface and the /merge command.
 * The run engine and merge_stage tool are mounted by later wiring; until then the command
 * answers read-only verbs and the routes expose rows/view with empty runs.
 */
import type { Context } from '@deepseek-ai/cordis'
import { evolutionHome, evolutionIoAdapter, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { loadMergeState } from './state.ts'
import { makeMergeRoutes, type MergeRouteSource } from './merge-routes.ts'
import { createMergeCommand, createReadOnlyMergeService } from './merge-command.ts'

export const inject: string[] = []

export function apply(ctx: Context): void {
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
