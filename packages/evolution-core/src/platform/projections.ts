/**
 * The session-projection half of the family's host platform boundary.
 *
 * The platform moved this port from "a disposer plus a registry read" to an awaitable handle. Both
 * are accepted here, and the port NAMES which shape it found: an unrecognised shape used to fall
 * through to the legacy read and return undefined for every unit without an error (audit 06-P1),
 * which reads as "the sessions have no projection data" instead of "this build cannot read them".
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
export type ProjectionPortShape = 'handle' | 'legacy' | 'unrecognised'

export interface ProjectionPort {
  /** The shape this port adapted to; `unrecognised` means reads will be empty and why. */
  readonly shape: ProjectionPortShape
  /** Why the port is `unrecognised`; absent while a usable shape was found. */
  readonly reason?: string | undefined
  register<K extends string, S>(definition: EvolutionProjectionDefinition<K, S>): Promise<ProjectionHandleLike<S>>
}

interface LegacyRegistry {
  register(definition: unknown): unknown
  stateOf?(session: Session, key: string): unknown
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  // A callable-thenable is a FUNCTION with \	hen\ (the deprecated shape); a plain Promise is an
  // object. Both must be awaited, or the callable one falls into the legacy branch by accident.
  (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function'

const isHandle = (value: unknown): value is { stateOf(session: Session): unknown; dispose(): Promise<void> } =>
  value !== null && typeof value === 'object'
  && typeof (value as { stateOf?: unknown }).stateOf === 'function'
  && typeof (value as { dispose?: unknown }).dispose === 'function'

/** Resolve the projection port; undefined means the host has no projection registry. */
export function projectionPort(ctx: Context): ProjectionPort | undefined {
  // platform-declaration anchor: sessionProjections is declared in core PLATFORM_SERVICE_PROBES.
  const registry = ctx.get('sessionProjections') as LegacyRegistry | undefined
  if (registry === undefined) return undefined
  let shape: ProjectionPortShape = 'unrecognised'
  let reason: string | undefined = 'sessionProjections.register has not answered yet'
  return {
    get shape() { return shape },
    get reason() { return shape === 'unrecognised' ? reason : undefined },
    async register<K extends string, S>(definition: EvolutionProjectionDefinition<K, S>): Promise<ProjectionHandleLike<S>> {
      const raw = registry.register(definition)
      // A callable-thenable and a plain Promise are the same contract from the caller's side.
      const resolved = isThenable(raw) ? await raw : raw
      if (isHandle(resolved)) {
        shape = 'handle'
        reason = undefined
        return {
          stateOf: (session) => resolved.stateOf(session) as S | undefined,
          dispose: () => resolved.dispose(),
        }
      }
      if (resolved === raw && typeof raw === 'function' && typeof registry.stateOf === 'function') {
        shape = 'legacy'
        reason = undefined
        return {
          stateOf: (session) => registry.stateOf?.(session, definition.key) as S | undefined,
          dispose: async () => { (raw as () => void)() },
        }
      }
      // Neither contract: keep reads empty, but say so through `shape`/`reason` instead of
      // pretending the units have no data.
      shape = 'unrecognised'
      reason = 'sessionProjections.register returned ' + (resolved === null ? 'null' : typeof resolved)
        + ' with neither a projection handle nor a legacy disposer'
      return { stateOf: () => undefined, dispose: async () => {} }
    },
  }
}
