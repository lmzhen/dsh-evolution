import type { DomainMapSnapshot, DomainMapStore } from './domain-map.ts'
import { bootstrapDomainMapWithFacts, type BootstrapSkillFact } from './domain-bootstrap.ts'
import type { DomainGenerationPort } from './domain-generation-service.ts'

/** Input for one initial map generation from a live skill view. */
export interface GenerationRequest {
  readonly mapScope: string
  readonly sourceDigest: string
  readonly expectedMapVersion: string
  readonly facts: readonly BootstrapSkillFact[]
  readonly prompt: string
  readonly promptVersion: string
  readonly model: string
  readonly runId: string
  readonly signal?: AbortSignal | undefined
}

/** Single-flight initial map generation; mapVersion CAS is the final arbiter. */
export class DomainGenerationCoordinator {
  private readonly store: DomainMapStore
  private readonly port: DomainGenerationPort
  private readonly inflight = new Map<string, Promise<DomainMapSnapshot>>()
  private epoch = 0

  constructor(store: DomainMapStore, port: DomainGenerationPort) {
    this.store = store
    this.port = port
  }

  /** @returns current map version; increment makes older requests stale. */
  get currentEpoch(): number { return this.epoch }

  /**
   * Generate an initial map once per scope; concurrent calls share one job.
   * @param request - live skills, stable keys, prompt, and CAS precondition.
   * @returns committed or existing snapshot.
   */
  async ensure(request: GenerationRequest): Promise<DomainMapSnapshot> {
    const current = await this.store.read()
    if (current.domains.length > 0) return current
    const existing = this.inflight.get(request.mapScope)
    if (existing !== undefined) return existing
    this.epoch += 1
    const epoch = this.epoch
    const job = this.run(request, epoch).finally(() => { this.inflight.delete(request.mapScope) })
    this.inflight.set(request.mapScope, job)
    return job
  }

  private async run(request: GenerationRequest, epoch: number): Promise<DomainMapSnapshot> {
    const current = await this.store.read()
    if (current.domains.length > 0) return current
    const proposal = await this.port.generate({ skills: request.facts.map(({ name, description, whenToUse }) => ({ name, description, ...whenToUse === undefined ? {} : { whenToUse } })), prompt: request.prompt, ...request.signal === undefined ? {} : { signal: request.signal } })
    if (epoch !== this.epoch) {
      const latest = await this.store.read()
      if (latest.domains.length > 0) return latest
      throw new Error('domain generation superseded by a newer source snapshot')
    }
    return bootstrapDomainMapWithFacts(this.store, proposal, request.facts, request.expectedMapVersion, { promptVersion: request.promptVersion, sourceDigest: request.sourceDigest, model: request.model, runId: request.runId })
  }
}
