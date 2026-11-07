/**
 * The session-projection half of the family's host platform boundary.
 *
 * The target 0.2.2 registry returns an awaitable callable-thenable handle;
 * the 0.2.1 registry returns a disposer function and reads through
 * registry.stateOf. Both forms are adapted here; the legacy branch is deleted
 * when platform-line moves to 0.2.2.
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

export interface ProjectionPort {
  register<K extends string, S>(definition: EvolutionProjectionDefinition<K, S>): Promise<ProjectionHandleLike<S>>
}

interface LegacyRegistry {
  register(definition: unknown): unknown
  stateOf?(session: Session, key: string): unknown
}

function isCallableThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'function' && typeof (value as { then?: unknown }).then === 'function'
}

/** Resolve the projection port; undefined means the host has no projection registry. */
export function projectionPort(ctx: Context): ProjectionPort | undefined {
  // platform-declaration anchor: sessionProjections is declared in core PLATFORM_SERVICE_PROBES.
  const registry = ctx.get('sessionProjections') as LegacyRegistry | undefined
  if (registry === undefined) return undefined
  return {
    async register<K extends string, S>(definition: EvolutionProjectionDefinition<K, S>): Promise<ProjectionHandleLike<S>> {
      const raw = registry.register(definition)
      if (isCallableThenable(raw)) {
        const resolved = await raw as unknown
        if (resolved !== null && typeof resolved === 'object' && typeof (resolved as { stateOf?: unknown }).stateOf === 'function') {
          const handle = resolved as {
            stateOf(session: Session): unknown
            dispose(): Promise<void>
          }
          return {
            stateOf: (session) => handle.stateOf(session) as S | undefined,
            dispose: () => handle.dispose(),
          }
        }
      }
      const dispose = raw as () => void
      return {
        stateOf: (session) => registry.stateOf?.(session, definition.key) as S | undefined,
        dispose: async () => { dispose() },
      }
    },
  }
}
