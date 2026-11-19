/**
 * The session-projection implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  EvolutionProjectionDefinition,
  ProjectionHandleLike,
  ProjectionPort,
  ProjectionPortShape,
} from '@deepseek-ai/dsh-evolution-platform-contract'

export type {
  EvolutionProjectionDefinition,
  ProjectionHandleLike,
  ProjectionPort,
  ProjectionPortShape,
} from '@deepseek-ai/dsh-evolution-platform-contract'

interface ProjectionRegistry {
  register(definition: unknown): unknown
}

const isHandle = (value: unknown): value is { stateOf(session: Session): unknown; dispose(): Promise<void> } =>
  value !== null && typeof value === 'object'
  && typeof (value as { stateOf?: unknown }).stateOf === 'function'
  && typeof (value as { dispose?: unknown }).dispose === 'function'

/** Resolve the projection port; undefined means the host has no projection registry. */
export function projectionPort(ctx: Context): ProjectionPort | undefined {
  // platform-declaration anchor: sessionProjections is declared in core PLATFORM_SERVICE_PROBES.
  const registry = ctx.get('sessionProjections') as ProjectionRegistry | undefined
  if (registry === undefined) return undefined
  let shape: ProjectionPortShape = 'unrecognised'
  let reason: string | undefined = 'sessionProjections.register has not answered yet'
  return {
    get shape() { return shape },
    get reason() { return shape === 'unrecognised' ? reason : undefined },
    async register<K extends string, S>(definition: EvolutionProjectionDefinition<K, S>): Promise<ProjectionHandleLike<S>> {
      const resolved = await registry.register(definition)
      if (isHandle(resolved)) {
        shape = 'handle'
        reason = undefined
        return {
          stateOf: (session) => resolved.stateOf(session) as S | undefined,
          dispose: () => resolved.dispose(),
        }
      }
      // Keep reads empty, but say so through `shape`/`reason` instead of pretending the
      // units have no data.
      shape = 'unrecognised'
      reason = 'sessionProjections.register returned ' + (resolved === null ? 'null' : typeof resolved)
        + ' without a projection handle'
      return { stateOf: () => undefined, dispose: async () => {} }
    },
  }
}
