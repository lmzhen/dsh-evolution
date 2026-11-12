// @tier pre-tag
// @vitest-environment node
/**
 * T4-09/A51: the staged window has a third terminal state.
 *
 * approve / reject / release were all human; an unattended deployment therefore accumulated staged
 * records for ever. The TTL closes the stale ones the way a REJECT does — through the state seam's
 * exactly-once transition, with `resolvedAt` stamped and the runner never invoked — so nothing a
 * human did not approve can execute.
 */
import { describe, expect, it } from 'vitest'
import { mountStateStack } from '../../test-support/state-stack.ts'
import { tempRoot } from '../../test-support/temp-home.ts'
import EvolutionApproval from '../src/index.ts'

/** One mounted approval service over the family state stack, with a runner spy. */
async function mountApproval(pendingTtlMs: number) {
  const root = await tempRoot('dsh-approval-ttl-')
  // `evolution: true` mounts the `evolutionState` facade the approval service injects — without it
  // the plugin never applies (its inject is unsatisfied) and `ctx.evolutionApproval` stays undefined.
  const ctx = await mountStateStack(root, { evolution: true })
  await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true, pendingTtlMs })
  const ran: string[] = []
  ctx.evolutionApproval.registerRunner('memory', async (args: unknown) => {
    ran.push(JSON.stringify(args))
    return { ok: true, message: 'ran' }
  })
  return { ctx, ran }
}

/** Stage one memory write and return its id. */
async function stage(ctx: Awaited<ReturnType<typeof mountApproval>>['ctx'], createdAt?: string): Promise<string> {
  const outcome = await ctx.evolutionApproval.request({
    kind: 'memory',
    summary: 'stage a memory write',
    args: { target: 'memory', action: 'add', facts: 'x', evidence: [{ event_seq: 0 }] },
    origin: 'background_review',
  })
  const id = String(outcome.pendingId)
  if (createdAt !== undefined) {
    // Backdate through the SEAM's own writer (the json provider), so the sweep reads real bytes and
    // the record still passes the field gate. Only the timestamp changes.
    const provider = ctx.evolutionStateStorage.provider('domain')
    const record = (await provider.listPending('pending')).find(item => item.id === id)
    if (record === undefined) throw new Error('the staged record did not land')
    await provider.savePending({ ...record, createdAt })
  }
  return id
}

describe('staged-window expiry (T4-09/A51)', () => {
  it('the shipped default (0) never expires: a stale record is still pending, and the TTL reads as 0', async () => {
    const { ctx, ran } = await mountApproval(0)
    const id = await stage(ctx, new Date(Date.now() - 86_400_000).toISOString())
    expect(ctx.evolutionApproval.ttlMs).toBe(0)
    const rows = await ctx.evolutionApproval.list('pending')
    expect(rows.map(row => row.id)).toContain(id)
    expect(ran).toEqual([])
  })

  it('a record past the TTL is closed as rejected with resolvedAt — and the runner never runs', async () => {
    const { ctx, ran } = await mountApproval(1000)
    const id = await stage(ctx, new Date(Date.now() - 60_000).toISOString())
    const rows = await ctx.evolutionApproval.list('pending')
    expect(rows.map(row => row.id)).not.toContain(id)
    const resolved = (await ctx.evolutionState.listPending('rejected')).find(item => item.id === id)
    expect(resolved).toBeDefined()
    expect(resolved?.resolvedAt).toBeTypeOf('string')
    // Expiry is the REJECT side of the triangle: an unapproved write must never execute.
    expect(ran).toEqual([])
  })

  it('P2-22: approving an expired record directly refuses and never runs it', async () => {
    const { ctx, ran } = await mountApproval(1000)
    const id = await stage(ctx, new Date(Date.now() - 60_000).toISOString())
    const outcome = await ctx.evolutionApproval.approve(id)
    expect(outcome.ok).toBe(false)
    expect(ran).toEqual([])
    expect((await ctx.evolutionState.listPending('rejected')).some(item => item.id === id)).toBe(true)
  })

  it('a FRESH record survives the sweep (the TTL is a bound, not a flush)', async () => {
    const { ctx } = await mountApproval(60_000)
    const id = await stage(ctx)
    const rows = await ctx.evolutionApproval.list('pending')
    expect(rows.map(row => row.id)).toContain(id)
  })

  it('uses evolutionMutationAuthority lease around approve', async () => {
    const { ctx } = await mountApproval(0)
    const released: string[] = []
    const fake = {
      lease: {
        async acquire() {
          return { ok: true, lease: { id: 'l2', owner: 'foreground', runId: 'approval:y', pid: 1, epoch: 1, issuedAt: 1, expiresAt: 1e12, heartbeatAt: 1, state: 'active' }, token: { id: 'l2', owner: 'foreground', runId: 'approval:y', epoch: 1 } }
        },
        async release(token: { id: string }) { released.push(token.id) },
      },
    }
    ctx.provide('evolutionMutationAuthority', fake)
    const id = await stage(ctx)
    const outcome = await ctx.evolutionApproval.approve(id)
    expect(outcome.ok).toBe(true)
    expect(released).toEqual(['l2'])
  })

  it('uses evolutionMutationAuthority lease around an expiry claim', async () => {
    const { ctx } = await mountApproval(1000)
    const released: string[] = []
    const fake = {
      lease: {
        async acquire() {
          return { ok: true, lease: { id: 'l1', owner: 'foreground', runId: 'approval:x', pid: 1, epoch: 1, issuedAt: 1, expiresAt: 1e12, heartbeatAt: 1, state: 'active' }, token: { id: 'l1', owner: 'foreground', runId: 'approval:x', epoch: 1 } }
        },
        async release(token: { id: string }) { released.push(token.id) },
      },
    }
    ctx.provide('evolutionMutationAuthority', fake)
    const id = await stage(ctx, new Date(Date.now() - 60_000).toISOString())
    await ctx.evolutionApproval.expireStale()
    expect(released).toEqual(['l1'])
    expect((await ctx.evolutionState.listPending('rejected')).some(item => item.id === id)).toBe(true)
  })

  it('releases the claim when an expiry reject throws — the record returns to pending', async () => {
    const { ctx } = await mountApproval(1000)
    const id = await stage(ctx, new Date(Date.now() - 60_000).toISOString())
    const provider = ctx.evolutionStateStorage.provider('domain') as unknown as { tryResolvePending: (...args: unknown[]) => Promise<unknown> }
    const original = provider.tryResolvePending.bind(provider)
    provider.tryResolvePending = async () => { throw new Error('injected reject failure') }
    try {
      await expect(ctx.evolutionApproval.expireStale()).resolves.toEqual([])
    } finally {
      provider.tryResolvePending = original
    }
    const pending = await ctx.evolutionState.listPending('pending')
    expect(pending.some(item => item.id === id)).toBe(true)
    const executing = await ctx.evolutionState.listPending('executing')
    expect(executing.some(item => item.id === id)).toBe(false)
  })

  it('an unparseable createdAt is not stale evidence — the record stays for the operator', async () => {
    const { ctx } = await mountApproval(1000)
    const id = await stage(ctx, 'not-a-date')
    const rows = await ctx.evolutionApproval.list('pending')
    expect(rows.map(row => row.id)).toContain(id)
  })
})
