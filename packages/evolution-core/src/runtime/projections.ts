/**
 * The family's projection runtime: register the five host-only units once and
 * expose typed reads to the pure readers. Missing registry or a registration
 * failure degrades to undefined (the existing fail-open posture), never throws
 * into the host.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { projectionPort, type ProjectionHandleLike, type Session } from '../platform/index.ts'
import {
  evolutionActivityProjection,
  evolutionEvidenceProjection,
  evolutionProjectionHistoryProjection,
  evolutionReadsProjection,
  evolutionSignalsProjection,
  type EvolutionActivityState,
  type EvolutionEvidenceState,
  type EvolutionProjectionHistoryState,
  type EvolutionReadsState,
  type EvolutionSignalsState,
} from '../session-projection.ts'

interface Handles {
  activity: ProjectionHandleLike<EvolutionActivityState>
  evidence: ProjectionHandleLike<EvolutionEvidenceState>
  reads: ProjectionHandleLike<EvolutionReadsState>
  history: ProjectionHandleLike<EvolutionProjectionHistoryState>
  signals: ProjectionHandleLike<EvolutionSignalsState>
}

/** Domain service owning the family's projection registrations. */
export class EvolutionProjections extends Service {
  static inject = []

  private handles: Handles | undefined
  private degradedReason: string | undefined

  constructor(ctx: Context) {
    super(ctx, 'evolutionProjections')
  }

  protected async [Service.init](): Promise<void> {
    const platform = this.ctx.get('evolutionPlatform') as { ports?: { projections?: import('../platform/projections.ts').ProjectionPort } } | undefined
    const port = platform?.ports?.projections ?? projectionPort(this.ctx)
    if (port === undefined) {
      this.markDegraded('sessionProjections service unavailable')
      return
    }
    const partial: Partial<Handles> = {}
    try {
      partial.activity = await port.register(evolutionActivityProjection)
      partial.evidence = await port.register(evolutionEvidenceProjection)
      partial.reads = await port.register(evolutionReadsProjection)
      partial.history = await port.register(evolutionProjectionHistoryProjection)
      partial.signals = await port.register(evolutionSignalsProjection)
      this.handles = partial as Handles
    } catch (error) {
      for (const handle of Object.values(partial).reverse()) {
        try { await handle.dispose() } catch { /* best-effort rollback; keep the original failure */ }
      }
      this.markDegraded('projection registration failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** Whether the five units are registered and readable. */
  status(): 'ready' | 'degraded' {
    return this.handles === undefined ? 'degraded' : 'ready'
  }

  /** Why the service is degraded; undefined while ready. */
  reason(): string | undefined {
    return this.handles === undefined ? this.degradedReason : undefined
  }

  activity(session: Session): EvolutionActivityState | undefined { return this.handles?.activity.stateOf(session) }
  evidence(session: Session): EvolutionEvidenceState | undefined { return this.handles?.evidence.stateOf(session) }
  reads(session: Session): EvolutionReadsState | undefined { return this.handles?.reads.stateOf(session) }
  history(session: Session): EvolutionProjectionHistoryState | undefined { return this.handles?.history.stateOf(session) }
  signals(session: Session): EvolutionSignalsState | undefined { return this.handles?.signals.stateOf(session) }

  private markDegraded(reason: string): void {
    this.degradedReason = reason
    this.ctx.logger.warn('evolution-core-runtime: %s; projection reads degrade to undefined', reason)
  }
}
