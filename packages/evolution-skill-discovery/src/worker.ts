import type { AssignmentQueueEntry, DomainAssignmentService } from './assignment.ts'

/** Queue view needed by the worker. */
export interface AssignmentQueueReader { list(): readonly AssignmentQueueEntry[] }

/** Drivable worker; the composition may call drain on a schedule. */
export class AssignmentWorker {
  private readonly service: DomainAssignmentService
  private readonly queue: AssignmentQueueReader
  constructor(service: DomainAssignmentService, queue: AssignmentQueueReader) { this.service = service; this.queue = queue }

  /** Process queued entries once; returns processed count. */
  async drain(limit = 10): Promise<number> {
    const entries = this.queue.list().filter(entry => entry.status === 'queued').slice(0, Math.max(0, limit))
    for (const entry of entries) await this.service.process(entry)
    return entries.length
  }
}
