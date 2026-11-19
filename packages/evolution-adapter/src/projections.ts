/**
 * The session-projection half of the family's host platform boundary.
 *
 * The 0.2.2 platform returns an awaitable `ProjectionHandle` (`stateOf` + `dispose`). The port
 * accepts that one contract and NAMES a non-conforming answer (`unrecognised`) instead of
 * returning undefined for every unit without an error (audit 06-P1).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ZodType } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** The family-owned shape of one projection unit; platform types stay behind the port. */
export interface EvolutionProjectionDefinition<K extends string, S> {
  readonly key: K
  readonly stateVersion: number
  readonly stateSchema: ZodType<S>
  readonly init: (header: unknown, inheritedEventCount: number) => S
  readonly apply: (state: S, event: SessionEvent) => S
}

/** One registered unit's read face, independent of the platform's handle class. */
export interface ProjectionHandleLike<S> {
  stateOf(session: Session): S | undefined
  dispose(): Promise<void>
}

/** Which registration contract the live registry speaks. */
export type ProjectionPortShape = 'handle' | 'unrecognised'

export interface ProjectionPort {
  /** The shape this port adapted to; `unrecognised` means reads will be empty and why. */
  readonly shape: ProjectionPortShape
  /** Why the port is `unrecognised`; absent while a usable shape was found. */
  readonly reason?: string | undefined
  register<K extends string, S>(definition: EvolutionProjectionDefinition<K, S>): Promise<ProjectionHandleLike<S>>
}

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
