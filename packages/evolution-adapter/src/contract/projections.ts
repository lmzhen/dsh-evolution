/**
 * The session-projection half of the family's platform contract.
 */
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
