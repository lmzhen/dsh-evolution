/**
 * The family's projection runtime: register the five host-only units and expose
 * typed reads to the pure readers. Registration follows the projection service
 * lifecycle: if `sessionProjections` mounts later (or is replaced), the units
 * attach then; a missing registry is not a permanent capability loss.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { type ProjectionHandleLike, type Session } from '../platform/index.ts'
import type { EvolutionPlatform } from './platform.ts'
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
  private generation = 0

  constructor(ctx: Context) {
    super(ctx, 'evolutionProjections')
  }

  protected async [Service.init](): Promise<void> {
    // Normal compositions mount the registry before this service: attach now so
    // the first reader observes registered units, exactly like the previous
    // awaited init. Only a missing registry takes the lifecycle path.
    // platform-declaration anchor: sessionProjections is declared in core PLATFORM_SERVICE_PROBES.
    if (this.ctx.get('sessionProjections') !== undefined) {
      await this.attach(this.ctx)
      return
    }
    this.ctx.inject(['evolutionPlatform', 'sessionProjections'], (scope) => {
      void this.attach(scope)
      return () => { void this.detach() }
    })
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

  private async attach(scope: Context): Promise<void> {
    const generation = ++this.generation
    await this.detachHandles()
    const platform = scope.get('evolutionPlatform') as EvolutionPlatform | undefined
    const port = platform?.ports.projections
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
      if (generation !== this.generation) {
        await this.disposePartial(partial)
        return
      }
      if (port.shape === 'unrecognised') {
        // A registered service whose reads are silently empty is DEGRADED, not "no projection data":
        // roll the registrations back and say why (audit 06-P1).
        await this.disposePartial(partial)
        this.markDegraded('projection port shape not recognised: ' + (port.reason ?? 'no reason reported'))
        return
      }
      this.handles = partial as Handles
      this.degradedReason = undefined
    } catch (error) {
      await this.disposePartial(partial)
      this.markDegraded('projection registration failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  private async detach(): Promise<void> {
    this.generation += 1
    await this.detachHandles()
  }

  private async detachHandles(): Promise<void> {
    const handles = this.handles
    this.handles = undefined
    if (handles === undefined) return
    for (const handle of Object.values(handles).reverse()) {
      try { await handle.dispose() } catch { /* best-effort teardown */ }
    }
  }

  private async disposePartial(partial: Partial<Handles>): Promise<void> {
    for (const handle of Object.values(partial).reverse()) {
      try { await handle.dispose() } catch { /* best-effort rollback */ }
    }
  }

  private markDegraded(reason: string): void {
    this.degradedReason = reason
    this.ctx.logger.warn('evolution-core-runtime: %s; projection reads degrade to undefined', reason)
  }
}

