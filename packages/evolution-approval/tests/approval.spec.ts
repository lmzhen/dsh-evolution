import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as JsonState from '@deepseek-ai/dsh-evolution-state-json'
import EvolutionState from '@deepseek-ai/dsh-evolution-state'
import EvolutionApproval from '../src/index.ts'
import { effectiveSessionPolicy } from '../src/index.ts'

describe('evolution-approval', () => {
  it('ignores a self-reported "never" when the platform service is mounted without a never stance (S3.1, E-22)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-s3a-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    ctx.provide('approval', { overrideOf: () => undefined })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    const staged = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'x', args: {}, origin: 'background_review', sessionId: 's1', sessionPolicy: 'never',
    })
    expect(staged.action).toBe('staged') // the self-report lost; default stands
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V6-27: a deployment-level config.policy=never allows without a session override (0.3.37)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-v627-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    // Platform mounted with NO per-session override: the deployment default
    // applies (overrideOf ?? config.policy ?? 'ask' — the exported chain).
    ctx.provide('approval', { overrideOf: () => undefined, config: { policy: 'never' } })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    const allowed = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'z', args: {}, origin: 'background_review', sessionId: 's1', sessionPolicy: 'ask',
    })
    expect(allowed.action).toBe('allow')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V6-27: the platform-shaped overrideOf receives the SESSION OBJECT, never the id string (0.3.40)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-v627-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    // REAL platform shape (user-approval): overrideOf resolves the policy from
    // the session log view — `snapshotEvents()` from 0.1.5 on — with NO guard,
    // so a bare id string would throw (`undefined.length`). Record what it saw.
    let probed: unknown
    const overrideOf = (session: unknown): 'ask' | 'never' | undefined => {
      probed = session
      // 0.1.5 removed the `events` getter, so the probe calls the accessor
      // unconditionally: a session without the log view must fail loudly here
      // instead of silently falling through to the config chain (a guarded
      // call kept this case green on BOTH platform lines and lost its edge).
      const snapshot = session as { snapshotEvents: () => Array<{ type: string; data: { policy: string } }> }
      const events = snapshot.snapshotEvents()
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index]?.type === 'approval/policy') return events[index]!.data.policy as 'ask' | 'never'
      }
      return undefined
    }
    ctx.provide('approval', { overrideOf, config: { policy: 'ask' } })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    // Caller passes the SESSION object (the session-override is honored).
    const sessionShape = { id: 's1', snapshotEvents: () => [{ type: 'approval/policy', data: { policy: 'never' } }] }
    const allowed = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'z', args: {}, origin: 'background_review', sessionId: 's1', session: sessionShape,
    })
    expect(allowed.action).toBe('allow')
    expect(probed).toBe(sessionShape)
    // WITHOUT a session object the id is NEVER handed to the platform probe
    // (a string would crash the real implementation) — config chain stands.
    const fallback = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'w', args: {}, origin: 'background_review', sessionId: 's2',
    })
    expect(fallback.action).toBe('staged')
    expect(probed).toBe(sessionShape) // unchanged — no string probe happened
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('allows when the platform service derives "never" even if the caller said "ask" (S3.1, E-22)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-s3b-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    ctx.provide('approval', { overrideOf: () => 'never' })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    const allowed = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'y', args: {}, origin: 'background_review', sessionId: 's1',
      session: { id: 's1', snapshotEvents: () => [] }, sessionPolicy: 'ask',
    })
    expect(allowed.action).toBe('allow')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('a crashed approve is never replayed: executing records block approve and reject cleans up (S3.3, E-24)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-s3crash-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    let executions = 0
    ctx.evolutionApproval.registerRunner('memory', async () => { executions += 1; return { ok: true, message: 'ok' } })
    await ctx.evolutionApproval.request({ kind: 'memory', summary: 'x', args: {}, origin: 'background_review' })
    const staged = (await ctx.evolutionApproval.list('pending'))[0]!
    // Simulate the crash: the record is claimed (→ executing) and the process
    // dies before the resolve. The runner never ran in this simulation.
    await ctx.evolutionState.claimPending(staged.id, 'crash-claim')
    const retry = await ctx.evolutionApproval.approve(staged.id)
    expect(retry.ok).toBe(false)
    expect(retry.message).toContain('executing')
    // V5-18 (0.3.31): the message attributes the execution to a CONCURRENT
    // in-flight approve as well and steers away from rejecting it — the old
    // crash-only wording could misdirect the operator into rejecting a live
    // approve another writer is running.
    expect(retry.message).toContain('do not reject')
    expect(executions).toBe(0) // ALWAYS zero duplication
    // Operator cleanup: reject resolves the executing record without a runner.
    const cleanup = await ctx.evolutionApproval.reject(staged.id)
    expect(cleanup.ok).toBe(true)
    expect(await ctx.evolutionApproval.list('pending').then(rows => rows.length)).toBe(0)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('stages background writes, keeps audit records and replays through a registered runner', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    let applied = 0
    ctx.evolutionApproval.registerRunner('memory', async (args) => {
      applied += 1
      return { ok: true, message: `memory ${JSON.stringify(args)}` }
    })

    const decision = await ctx.evolutionApproval.request({
      kind: 'memory',
      summary: 'remember user name',
      args: { action: 'add', facts: 'name: Ada' },
      origin: 'background_review',
    })
    expect(decision.action).toBe('staged')

    const pending = await ctx.evolutionApproval.list('pending')
    expect(pending).toHaveLength(1)
    const approve = await ctx.evolutionApproval.approve(pending[0]!.id)
    expect(approve.ok).toBe(true)
    expect(applied).toBe(1)
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(0)
    expect(await ctx.evolutionApproval.list('approved')).toHaveLength(1)

    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('keeps a pending record when the runner fails and retains rejection audit', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-fail-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    ctx.evolutionApproval.registerRunner('memory', async () => ({ ok: false, message: 'replay failed' }))
    const decision = await ctx.evolutionApproval.request({ kind: 'memory', summary: 'fail', args: {}, origin: 'background_review' })
    const failed = await ctx.evolutionApproval.approve(decision.pendingId!)
    expect(failed.ok).toBe(false)
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(1)
    const rejected = await ctx.evolutionApproval.reject(decision.pendingId!)
    expect(rejected.ok).toBe(true)
    expect(await ctx.evolutionApproval.list('rejected')).toHaveLength(1)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('runs the replay exactly once when approve is called concurrently', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-atomic-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    let applied = 0
    ctx.evolutionApproval.registerRunner('memory', async () => {
      await new Promise(resolve => setTimeout(resolve, 25))
      applied += 1
      return { ok: true, message: 'memory applied' }
    })

    const decision = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'atomic approval', args: { action: 'add', facts: 'x' }, origin: 'background_review',
    })
    const [a, b] = await Promise.all([
      ctx.evolutionApproval.approve(decision.pendingId!),
      ctx.evolutionApproval.approve(decision.pendingId!),
    ])
    // v21 (T-6) correction of the first tightening attempt: CONCURRENT
    // approve calls are coalesced by the in-flight dedupe (`approve:${id}`),
    // so both callers share the SAME single execution and the same ok:true —
    // there is no "loser" to demand ok:false from. The audit-lying shape the
    // original finding worried about is the SEQUENTIAL double approve, and
    // that is pinned separately (V4-18: the second approve reports ok:false
    // "already resolved"). The pin here stays: exactly ONE runner execution,
    // and both concurrent callers observe its success.
    expect(applied).toBe(1)
    expect([a.ok, b.ok].every(Boolean)).toBe(true)

    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('reject on an executing record races an in-flight approve: audit stays honest, write still runs once (S3.3, F-204)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-race-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    let executions = 0
    let releaseRunner: (() => void) | undefined
    // Gate the runner so a reject can interleave while it is "in flight".
    const gate = new Promise<void>((resolve) => { releaseRunner = resolve })
    ctx.evolutionApproval.registerRunner('memory', async () => {
      executions += 1
      await gate
      return { ok: true, message: 'memory applied' }
    })

    const decision = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'race', args: { action: 'add', facts: 'x' }, origin: 'background_review',
    })
    const id = decision.pendingId!
    // Start the approve runner (claims → 'executing', then blocks on the gate).
    const approve = ctx.evolutionApproval.approve(id)
    // Wait until the record is actually 'executing' so reject hits the
    // executing-rescue path (the claim is held by the in-flight approve).
    for (let i = 0; i < 500; i++) {
      if ((await ctx.evolutionApproval.list('executing')).some(record => record.id === id)) break
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    // The operator rejects while the runner is still in flight.
    const rejected = await ctx.evolutionApproval.reject(id)
    expect(rejected.ok).toBe(true)
    // The message is honest about the race window, not "crashed approve cleaned up".
    expect(rejected.message).toContain('no claim held')
    expect(rejected.message).toMatch(/verify the write state manually/i)
    // Release the runner: the write completes AFTER reject already resolved it.
    releaseRunner!()
    const approved = await approve
    expect(approved.ok).toBe(false) // the claim-scoped resolve refuses — the record is no longer ours
    // P2-2 (v14): the message now names the DIVERGENCE (write landed, audit
    // reads rejected) instead of the generic "already resolved".
    expect(approved.message).toContain('resolved to "rejected" concurrently')
    expect(approved.message).toContain('do NOT replay it')
    // The write ran exactly once (it did land even though the audit reads rejected).
    expect(executions).toBe(1)
    expect(await ctx.evolutionApproval.list('rejected')).toHaveLength(1)
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(0)
    expect(await ctx.evolutionApproval.list('executing')).toHaveLength(0)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('allows writes without staging when the session policy is never', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-never-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    const decision = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'unattended write', args: { action: 'add', facts: 'x' }, origin: 'foreground', sessionPolicy: 'never',
    })
    expect(decision.action).toBe('allow')
    expect(decision.message).toContain('never')
    // Nothing was staged for an unattended session: no unanswerable tail.
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(0)
    // Default behavior stays: 'ask' still stages.
    const askDecision = await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'interactive write', args: { action: 'add', facts: 'y' }, origin: 'foreground', sessionPolicy: 'ask',
    })
    expect(askDecision.action).toBe('staged')

    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('normalizes approval summaries: truncation, batch label and archive warning', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-summary-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })

    await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'x'.repeat(300), args: { action: 'add', facts: 'a' }, origin: 'background_review',
    })
    await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'memory batch', args: { operations: [{ action: 'add' }, { action: 'add' }, { action: 'remove' }], target: 'user' }, origin: 'background_review',
    })
    await ctx.evolutionApproval.request({
      kind: 'skill', summary: 'skill delete old-skill', args: { operation: { action: 'delete' }, origin: 'background_review' }, origin: 'background_review',
    })
    await ctx.evolutionApproval.request({
      kind: 'memory', summary: 'memory batch', args: { operations: [{ action: 'add' }, { action: 'add' }, { action: 'remove' }] }, origin: 'background_review',
    })
    const pending = await ctx.evolutionApproval.list('pending')
    const bySummary = (suffix: string) => pending.find(item => item.summary.endsWith(suffix))?.summary
    expect(bySummary('...')).toHaveLength(120)
    expect(pending.some(item => item.summary === 'memory user batch of 3 operations')).toBe(true)
    expect(pending.some(item => item.summary === 'memory batch of 3 operations')).toBe(true)
    expect(pending.some(item => item.summary === 'skill delete old-skill (warning: archive)')).toBe(true)

    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  it('hasRunner mirrors the runner registry for the P1-9 pre-check', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-hasrunner-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(false)
    const dispose = ctx.evolutionApproval.registerRunner('memory', async () => ({ ok: true, message: 'ok' }))
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(true)
    dispose()
    expect(ctx.evolutionApproval.hasRunner('memory')).toBe(false)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V4-18: a rotated/unknown id is reported out of the pending window, not as a live concurrent writer', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-v4-18-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    // A never-staged id (or one rotated past PENDING_RESOLVED_CAP) is NOT a
    // live "another writer" — the old message mis-attributed it. Both approve
    // and reject must name the real cause.
    const missing = '00000000-0000-4000-8000-000000000000'
    const approve = await ctx.evolutionApproval.approve(missing)
    expect(approve.ok).toBe(false)
    expect(approve.message).toContain('not in the pending window')
    const reject = await ctx.evolutionApproval.reject(missing)
    expect(reject.ok).toBe(false)
    expect(reject.message).toContain('not in the pending window')
    // The executing branch stays intact (the crashed-approve cleanup path).
    const decision = await ctx.evolutionApproval.request({ kind: 'memory', summary: 'x', args: {}, origin: 'background_review' })
    const id = decision.pendingId!
    await ctx.evolutionState.claimPending(id, 'crash-claim')
    const executing = await ctx.evolutionApproval.approve(id)
    expect(executing.ok).toBe(false)
    expect(executing.message).toContain('executing')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V9-12: a replay runner that THROWS keeps the record pending with its claim released (distinct from {ok:false})', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-throw-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    ctx.evolutionApproval.registerRunner('memory', async () => { throw new Error('runner backend exploded') })
    const decision = await ctx.evolutionApproval.request({ kind: 'memory', summary: 'boom', args: {}, origin: 'background_review' })
    const id = decision.pendingId!
    const failed = await ctx.evolutionApproval.approve(id)
    expect(failed.ok).toBe(false)
    // The throw shape (not the runner {ok:false} shape): record stays pending
    // AND the claim is released — a retry or reject can still act on it.
    expect(failed.message).toContain('remains pending')
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(1)
    expect(await ctx.evolutionApproval.list('executing')).toHaveLength(0)
    const retry = await ctx.evolutionApproval.approve(id)
    expect(retry.ok).toBe(false)
    expect(retry.message).not.toContain('already resolved')
    const rejected = await ctx.evolutionApproval.reject(id)
    expect(rejected.ok).toBe(true)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V9-12: approve with NO replay runner releases the claim — record stays pending and rejectable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-norunner-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    // No registerRunner at all (host-only composition case).
    const decision = await ctx.evolutionApproval.request({ kind: 'memory', summary: 'orphan', args: {}, origin: 'background_review' })
    const id = decision.pendingId!
    const approve = await ctx.evolutionApproval.approve(id)
    expect(approve.ok).toBe(false)
    expect(approve.message).toContain('No replay runner registered')
    expect(await ctx.evolutionApproval.list('pending')).toHaveLength(1)
    expect(await ctx.evolutionApproval.list('executing')).toHaveLength(0)
    const rejected = await ctx.evolutionApproval.reject(id)
    expect(rejected.ok).toBe(true)
    expect(await ctx.evolutionApproval.list('rejected')).toHaveLength(1)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('0.3.66: a capability record outlives the retired adapter — stageable and answerable with no runner', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-capability-'))
    const ctx = new Context()
    await ctx.plugin(EvolutionStateStorageRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(JsonState, { root: home })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    // The adapter that produced capability writes was removed in 0.3.66, so a
    // record staged by a ≤0.3.65 install is the only consumer this kind has left:
    // staging must still work with no runner, and approving must resolve it
    // without executing anything.
    const decision = await ctx.evolutionApproval.request({ kind: 'capability', summary: 'capability demo', args: { name: 'demo' }, origin: 'foreground' })
    expect(decision.action).toBe('staged')
    const approved = await ctx.evolutionApproval.approve(decision.pendingId!)
    expect(approved.ok).toBe(true)
    expect(approved.message).toContain('no code was executed')
    expect(await ctx.evolutionApproval.list('approved')).toHaveLength(1)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  describe('effectiveSessionPolicy (G4.8, F-341)', () => {
    it('returns undefined when the platform approval service is not mounted', () => {
      const ctx = new Context()
      expect(effectiveSessionPolicy(ctx, {})).toBeUndefined()
    })

    it('returns undefined when no session is available even with the service mounted', () => {
      const ctx = new Context()
      ctx.provide('approval', { overrideOf: () => 'never', config: { policy: 'ask' } })
      expect(effectiveSessionPolicy(ctx, undefined)).toBeUndefined()
    })

    it('lets the override win over the configured default', () => {
      const ctx = new Context()
      ctx.provide('approval', { overrideOf: () => 'never', config: { policy: 'ask' } })
      expect(effectiveSessionPolicy(ctx, {})).toBe('never')
    })

    it('falls back to config.policy when the override is absent', () => {
      const ctx = new Context()
      ctx.provide('approval', { overrideOf: () => undefined, config: { policy: 'never' } })
      expect(effectiveSessionPolicy(ctx, {})).toBe('never')
    })

    it('defaults to ask when neither override nor config policy is present', () => {
      const ctx = new Context()
      ctx.provide('approval', { overrideOf: () => undefined, config: {} })
      expect(effectiveSessionPolicy(ctx, {})).toBe('ask')
    })

    it('v20 (B-1): a bare platform stub WITHOUT a config field degrades to ask instead of throwing', () => {
      // The runtime platform service can be a bare stub (`config` absent) —
      // the direct `approval.config.policy` deref used to TypeError here on
      // every caller (each /graph write probes this helper), while the
      // in-class deriveSessionPolicy had already been hardened (V6-27).
      const ctx = new Context()
      ctx.provide('approval', { overrideOf: () => undefined })
      expect(effectiveSessionPolicy(ctx, {})).toBe('ask')
    })
  })

})

it('v28 G1.3 (APPR-01): a failed resolve after a successful runner reports the landed write instead of throwing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-approval-g13-'))
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root: home })
  await ctx.plugin(EvolutionState)
  await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
  ctx.evolutionApproval.registerRunner('memory', async () => ({ ok: true, message: 'memory written' }))
  const decision = await ctx.evolutionApproval.request({
    kind: 'memory', summary: 'x', args: {}, origin: 'background_review', sessionId: 's1', sessionPolicy: 'ask',
  })
  expect(decision.action).toBe('staged')
  const pendingId = decision.pendingId!
  // Fault: the state resolve throws (quarantine / lock-budget class) AFTER the
  // runner has landed its effect.
  const state = ctx.evolutionState as unknown as { tryResolvePending: () => Promise<never> }
  const original = state.tryResolvePending
  state.tryResolvePending = async () => { throw new Error('corrupt pending-state.json (quarantined)') }
  try {
    const result = await ctx.evolutionApproval.approve(pendingId)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('LANDED')
    expect(result.message).toContain('corrupt pending-state.json')
  } finally {
    state.tryResolvePending = original
  }
  // The claim stays 'executing' — approve refuses to re-run it (no double write).
  const again = await ctx.evolutionApproval.approve(pendingId)
  expect(again.ok).toBe(false)
  expect(again.message).toMatch(/executing|already/i)
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
