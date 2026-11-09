// @tier fast
import { describe, expect, it } from 'vitest'
import { MutationUnit, type MutationRequest, type MutationLockPort, type MutationJournalRecord, type EvolutionIoLike, type MutationSnapshotPort, type MutationUnitHooks } from '@deepseek-ai/dsh-evolution-core'

class MemoryIo implements EvolutionIoLike {
  readonly files = new Map<string, string>()
  failWrite: string | undefined
  failedOnce = false
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> {
    if (!this.failedOnce && this.failWrite !== undefined && path.includes(this.failWrite)) {
      this.failedOnce = true
      throw new Error('injected write failure')
    }
    this.files.set(path, content)
  }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) { this.files.delete(from); this.files.set(to, value) } }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) this.files.set(to, value) }
}

const LIMITS = { maxSkillFileBytes: 1000, maxSkillContentChars: 1000 }

function request(overrides: Partial<MutationRequest> = {}): MutationRequest {
  return {
    name: 'source',
    roots: [{ name: 'source', protection: 'write' }],
    ops: [
      { kind: 'write', target: 'source/SKILL.md', content: 'new', expected: 'old', skill: 'source' },
    ],
    origin: 'foreground',
    auditAction: 'extract',
    auditSummary: 'demo',
    eventAction: 'extract',
    ...overrides,
  }
}

function unit(io: MemoryIo, overrides: { lock?: MutationLockPort; journal?: { write(record: MutationJournalRecord): Promise<void> }; snapshots?: MutationSnapshotPort; hooks?: MutationUnitHooks; context?: { owner: 'foreground' | 'background_review'; runId: string; leaseId: string } } = {}) {
  return new MutationUnit({ io, limits: LIMITS, ...(overrides.lock === undefined ? { nested: true } : {}), ...overrides })
}

class MemorySnapshots implements MutationSnapshotPort {
  readonly items = new Map<string, Parameters<MutationSnapshotPort['write']>[0]>()
  async write(snapshot: Parameters<MutationSnapshotPort['write']>[0]): Promise<void> { this.items.set(snapshot.unitId, snapshot) }
  async read(unitId: string): Promise<Parameters<MutationSnapshotPort['write']>[0] | null> { return this.items.get(unitId) ?? null }
  async listPrepared(): Promise<Array<Parameters<MutationSnapshotPort['write']>[0]>> { return [...this.items.values()].filter(item => item.state === 'prepared') }
}

class CommittedWarningIo extends MemoryIo {
  override async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content)
    throw Object.assign(new Error('simulated dir-fsync failure'), { committed: true })
  }
}

describe('MutationUnit executor', () => {
  it('refuses construction without a lock or an explicit nested mark', () => {
    expect(() => new MutationUnit({ io: new MemoryIo(), limits: LIMITS })).toThrow(/lock.*nested/i)
  })

  it('writes the plan and journals committed', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const events: string[] = []
    const result = await unit(io, { journal: { async write(record) { events.push(record.phase) } } }).apply(request())
    expect(result.ok).toBe(true)
    expect(io.files.get('source/SKILL.md')).toBe('new')
    expect(events).toEqual(['prepared', 'unit-written', 'committed'])
  })

  it('stamps the mutation context on snapshots', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const snapshots = new MemorySnapshots()
    const result = await unit(io, { snapshots, context: { owner: 'background_review', runId: 'review-1', leaseId: 'lease-1' } }).apply(request())
    expect(result.ok).toBe(true)
    expect([...snapshots.items.values()][0]).toMatchObject({ owner: 'background_review', runId: 'review-1', leaseId: 'lease-1', state: 'committed' })
  })

  it('stamps the run id onto journal records when a context is present', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const records: MutationJournalRecord[] = []
    await unit(io, { journal: { async write(record) { records.push(record) } }, context: { owner: 'background_review', runId: 'review-2', leaseId: 'lease-2' } }).apply(request())
    expect(records[0]?.runId).toBe('review-2')
    expect(records.every(record => record.runId === 'review-2')).toBe(true)
  })

  it('acquires and releases an optional target claim around the write', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    let acquired = 0
    let released = 0
    const unitWithClaim = new MutationUnit({ io, limits: LIMITS, nested: true, claimRunId: 'run-1', claim: { async acquire(target, runId) { acquired += 1; expect(target).toBe('source'); expect(runId).toBe('run-1'); return { async release() { released += 1 } } } } })
    const result = await unitWithClaim.apply(request())
    expect(result.ok).toBe(true)
    expect(acquired).toBe(1)
    expect(released).toBe(1)
  })

  it('refuses the write when the target claim cannot be acquired', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const unitWithClaim = new MutationUnit({ io, limits: LIMITS, nested: true, claimRunId: 'run-1', claim: { async acquire() { throw new Error('claim busy') } } })
    const result = await unitWithClaim.apply(request())
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.code).toBe('claim-failed')
    expect(io.files.get('source/SKILL.md')).toBe('old')
  })

  it('keeps a committed-only write as success with a warning', async () => {
    const io = new CommittedWarningIo(); io.files.set('source/SKILL.md', 'old')
    const result = await unit(io).apply(request())
    expect(result.ok).toBe(true)
    expect(result.warnings?.[0]).toContain('dir-fsync')
    expect(io.files.get('source/SKILL.md')).toBe('new')
  })

  it('refuses a CAS drift before any write', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'other')
    const result = await unit(io).apply(request())
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.code).toBe('cas-drift')
    expect(io.files.get('source/SKILL.md')).toBe('other')
  })

  it('P1-1: re-checks the baseline inside the bound transact', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    let mutated = false
    const transact = (async (backend: EvolutionIoLike, path: string, task: (current: string | null) => string | null | Promise<string | null>) => {
      const memory = backend as MemoryIo
      if (!mutated) { mutated = true; memory.files.set(path, 'CONCURRENT') }
      const next = await task(await memory.readText(path))
      if (next === null) memory.files.delete(path)
      else memory.files.set(path, next)
    }) as never
    const result = await new MutationUnit({ io, limits: LIMITS, nested: true, transact }).apply(request())
    expect(result.ok).toBe(false)
    expect(io.files.get('source/SKILL.md')).toBe('CONCURRENT')
  })

  it('P1-2: a conflict inside io.transact does not roll stale bytes back over the concurrent write', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    ;(io as unknown as { transact: (path: string, task: (current: string | null) => string | null | Promise<string | null>) => Promise<void> }).transact = async (path, task) => {
      io.files.set(path, 'CONCURRENT')
      const next = await task(await io.readText(path))
      if (next === null) io.files.delete(path)
      else io.files.set(path, next)
    }
    const result = await unit(io).apply(request())
    expect(result.ok).toBe(false)
    expect(io.files.get('source/SKILL.md')).toBe('CONCURRENT')
  })

  it('P2-1: writes the committed snapshot before the committed journal', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const order: string[] = []
    const snapshots: MutationSnapshotPort = {
      async write(snapshot) { order.push('snapshot:' + snapshot.state) },
      async read() { return null },
      async listPrepared() { return [] },
    }
    const result = await unit(io, {
      snapshots,
      journal: { async write(record) { order.push('journal:' + record.phase) } },
    }).apply(request())
    expect(result.ok).toBe(true)
    expect(order.indexOf('snapshot:committed')).toBeGreaterThan(-1)
    expect(order.indexOf('journal:committed')).toBeGreaterThan(order.indexOf('snapshot:committed'))
  })

  it('rolls back a later write failure', async () => {
    const io = new MemoryIo()
    io.files.set('source/SKILL.md', 'old-a')
    io.files.set('source/references/b.md', 'old-b')
    io.failWrite = 'b.md'
    const result = await unit(io).apply(request({ ops: [
      { kind: 'write', target: 'source/SKILL.md', content: 'new-a', expected: 'old-a', skill: 'source' },
      { kind: 'write', target: 'source/references/b.md', content: 'new-b', expected: 'old-b', skill: 'source' },
    ] }))
    expect(result.ok).toBe(false)
    expect(io.files.get('source/SKILL.md')).toBe('old-a')
    expect(io.files.get('source/references/b.md')).toBe('old-b')
  })

  it('dry-run writes nothing', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const result = await unit(io).apply(request({ dryRun: true }))
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(io.files.get('source/SKILL.md')).toBe('old')
  })

  it('undo restores the previous bytes and marks the snapshot undone', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const snapshots = new MemorySnapshots()
    const result = await unit(io, { snapshots }).apply(request())
    expect(result.ok).toBe(true)
    expect(io.files.get('source/SKILL.md')).toBe('new')
    const undo = await unit(io, { snapshots }).undo(result.unitId)
    expect(undo.ok).toBe(true)
    expect(io.files.get('source/SKILL.md')).toBe('old')
    expect(snapshots.items.get(result.unitId)?.state).toBe('undone')
  })

  it('recovers a prepared unit to before bytes', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const snapshots = new MemorySnapshots()
    await snapshots.write({ unitId: 'prepared-1', state: 'prepared', createdAt: 1, ops: [{ target: 'source/SKILL.md', before: 'old', after: 'new', skill: 'source' }] })
    io.files.set('source/SKILL.md', 'new')
    const result = await unit(io, { snapshots }).recover('prepared-1')
    expect(result.ok).toBe(true)
    expect(io.files.get('source/SKILL.md')).toBe('old')
    expect(snapshots.items.get('prepared-1')?.state).toBe('undone')
  })

  it('recoverPrepared processes every prepared snapshot', async () => {
    const io = new MemoryIo()
    io.files.set('source/SKILL.md', 'new')
    const snapshots = new MemorySnapshots()
    await snapshots.write({ unitId: 'boot-1', state: 'prepared', createdAt: 1, ops: [{ target: 'source/SKILL.md', before: 'old', after: 'new', skill: 'source' }] })
    const results = await unit(io, { snapshots }).recoverPrepared()
    expect(results).toHaveLength(1)
    expect(results[0]?.ok).toBe(true)
    expect(io.files.get('source/SKILL.md')).toBe('old')
  })

  it('refuses recovery when a prepared target drifted', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'other')
    const snapshots = new MemorySnapshots()
    await snapshots.write({ unitId: 'prepared-2', state: 'prepared', createdAt: 1, ops: [{ target: 'source/SKILL.md', before: 'old', after: 'new', skill: 'source' }] })
    const result = await unit(io, { snapshots }).recover('prepared-2')
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.code).toBe('recover-drift')
    expect(io.files.get('source/SKILL.md')).toBe('other')
  })

  it('refuses undo after target drift', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const snapshots = new MemorySnapshots()
    const result = await unit(io, { snapshots }).apply(request())
    io.files.set('source/SKILL.md', 'other')
    const undo = await unit(io, { snapshots }).undo(result.unitId)
    expect(undo.ok).toBe(false)
    expect(undo.errors[0]?.code).toBe('undo-preflight')
    expect(io.files.get('source/SKILL.md')).toBe('other')
  })

  it('calls committed hook with the unit ops', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const events: string[] = []
    const result = await unit(io, { hooks: { committed(event) { events.push(event.unitId + ':' + event.ops.length) } } }).apply(request())
    expect(result.ok).toBe(true)
    expect(events).toEqual([result.unitId + ':1'])
  })

  it('calls rolledBack hook after a rollback', async () => {
    const io = new MemoryIo()
    io.files.set('source/SKILL.md', 'old-a')
    io.files.set('source/references/b.md', 'old-b')
    io.failWrite = 'b.md'
    const events: string[] = []
    const result = await unit(io, { hooks: { rolledBack(event) { events.push(event.unitId) } } }).apply(request({ ops: [
      { kind: 'write', target: 'source/SKILL.md', content: 'new-a', expected: 'old-a', skill: 'source' },
      { kind: 'write', target: 'source/references/b.md', content: 'new-b', expected: 'old-b', skill: 'source' },
    ] }))
    expect(result.ok).toBe(false)
    expect(events).toEqual([result.unitId])
  })

  it('returns a structured lock failure', async () => {
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    const lock: MutationLockPort = { async acquire() { throw new Error('busy') } }
    const result = await unit(io, { lock }).apply(request())
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.code).toBe('unit-fence-failed')
  })

  it('releases the lock after success and failure', async () => {
    let releases = 0
    const lock: MutationLockPort = { async acquire() { return { async release() { releases += 1 } } } }
    const io = new MemoryIo(); io.files.set('source/SKILL.md', 'old')
    await unit(io, { lock }).apply(request())
    await unit(io, { lock }).apply(request({ ops: [{ kind: 'write', target: 'source/SKILL.md', content: 'x', expected: 'wrong', skill: 'source' }] }))
    expect(releases).toBe(2)
  })
})
