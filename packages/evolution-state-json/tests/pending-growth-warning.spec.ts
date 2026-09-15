/**
 * S2-12 (FLOW5-3 / FLOW5-4): the staged table's growth signals.
 *
 * - FLOW5-3: the record-COUNT warn was the only signal, and it says nothing
 *   about bytes — one staged record can carry a whole skill body in `args`, and
 *   every pending mutation rewrites the whole state file.
 * - FLOW5-4: the count warn lived only in `savePending`, so a deployment whose
 *   approvals move records through claim/resolve grew with no trace at all.
 * Both warns fire once per over-bound episode and re-arm when the table comes
 * back under the bound; the path that observed it is named in the message.
 */
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { PendingRecord } from '@deepseek-ai/dsh-evolution-state-storage'
import { mountStateStack } from '../../test-support/state-stack.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

const pending = (id: string): PendingRecord => ({
  id, kind: 'memory', summary: `s:${id}`, args: {}, createdAt: 'now', status: 'pending',
})

async function mountPending(seeded: Record<string, PendingRecord>) {
  const root = await tempRoot('dsh-json-growth-')
  const ctx = await mountStateStack(root)
  const io = ctx.evolutionIo.provider('node')
  await io.writeText(join(root, 'pending-state.json'), JSON.stringify(seeded))
  const warnSpy = vi.spyOn(ctx.logger, 'warn')
  return { ctx, provider: ctx.evolutionStateStorage.provider('json'), warnSpy }
}

describe('staged-table growth warnings (S2-12)', () => {
  it('FLOW5-3: a staged payload over the byte budget warns once, and re-arms after it is resolved', async () => {
    const { provider, warnSpy } = await mountPending({})
    const big = { blob: 'x'.repeat(1_100_000) }
    await provider.savePending({ ...pending('big'), args: big })
    const byteWarns = () => warnSpy.mock.calls.filter(call => String(call[0]).includes('bytes of staged args'))
    expect(byteWarns()).toHaveLength(1)
    expect(String(byteWarns()[0]![0])).toContain('after save')
    // The once-flag holds while the table stays over the bound.
    await provider.savePending({ ...pending('big-2'), args: big })
    expect(byteWarns()).toHaveLength(1)
    // Resolving both drops it under the budget, so the next oversized stage warns again.
    await provider.tryResolvePending('big', 'approved')
    await provider.tryResolvePending('big-2', 'approved')
    await provider.savePending({ ...pending('big-3'), args: big })
    expect(byteWarns()).toHaveLength(2)
  })

  it('FLOW5-4: the record-count warn also fires on the CLAIM path', async () => {
    const seeded: Record<string, PendingRecord> = {}
    for (let index = 0; index <= 200; index += 1) seeded[`seed-${index}`] = pending(`seed-${index}`)
    const { provider, warnSpy } = await mountPending(seeded)
    await provider.claimPending('seed-0', 'claim-a')
    const countWarns = warnSpy.mock.calls.filter(call => String(call[0]).includes('pending/executing staged records exceed'))
    expect(countWarns).toHaveLength(1)
    expect(String(countWarns[0]![0])).toContain('after claim')
  })

  it('FLOW5-4: the record-count warn also fires on the RESOLVE path', async () => {
    const seeded: Record<string, PendingRecord> = {}
    // 202 live: resolving one leaves 201, still over the cap of 200.
    for (let index = 0; index <= 201; index += 1) seeded[`seed-${index}`] = pending(`seed-${index}`)
    const { provider, warnSpy } = await mountPending(seeded)
    await provider.tryResolvePending('seed-0', 'approved')
    const countWarns = warnSpy.mock.calls.filter(call => String(call[0]).includes('pending/executing staged records exceed'))
    expect(countWarns).toHaveLength(1)
    expect(String(countWarns[0]![0])).toContain('after resolve')
  })
})
