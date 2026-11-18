// @tier ci-only
/**
 * S2-12③ (FLOW5-4): the memory budget's two configuration surfaces.
 *
 * `memory-files`' store limit and `evolution-policy`'s `memoryChars`/`userChars`
 * used to default independently, so moving one left the other behind: the review
 * planned ops for a budget the store then refused. An UNSET limit now follows the
 * mounted policy, an explicit contradiction warns once, and the effective budget
 * (+ which surface won) is published as `evolutionMemoryBudget` for doctor.
 *
 * "Unset" is the absence of the canonical live field; an explicit value is
 * always config, even when it happens to equal the policy or factory default.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-core/io-registry'
import * as NodeIo from '@deepseek-ai/dsh-evolution-core/io-node'
import * as MemoryFiles from '../../src/files/index.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { mutableVol } from '../../../test-support/volatile-config.ts'

interface Budget {
  memoryChars: number
  userChars: number
  memorySource: string
  userSource: string
}

async function context(policy?: { memoryChars: number; userChars: number; memoryTokens?: number; userTokens?: number }) {
  const ctx = new Context()
  await ctx.plugin(MemoryRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  if (policy !== undefined) ctx.provide('evolutionPolicy', { get: () => policy })
  return ctx
}

/** A fake platform settings provider carrying only the user layer: G1 keeps one
 * read of it — the KEY NAMES `describe()` reports, which name the winning surface.
 * The user VALUE reaches the plugin through the row's live field, so the test
 * supplies that value as a mutable reference (see the live case below). */
function provideSettings(ctx: Context, user: Record<string, unknown>) {
  ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'settings', {
    // The platform's settings id is the Loader entry id, i.e. the ROW id — the legacy
    // namespace string ('evolution-memory') is only the G3 migration source.
    describe: () => [{ ns: 'memory-files', user }],
  })
}

const budgetOf = (ctx: Context): Budget =>
  (ctx as unknown as { get(name: string): unknown }).get('evolutionMemoryBudget') as Budget

describe('memory budget surfaces (S2-12③)', () => {
  it('an UNSET limit follows the mounted policy, and says so', async () => {
    const ctx = await context({ memoryChars: 4000, userChars: 900 })
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-') })
    const budget = budgetOf(ctx)
    expect(budget.memoryChars).toBe(4000)
    expect(budget.userChars).toBe(900)
    expect(budget.memorySource).toBe('policy')
    expect(budget.userSource).toBe('policy')
  })

  it('without a policy an UNSET limit keeps the package default', async () => {
    const ctx = await context()
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-') })
    const budget = budgetOf(ctx)
    expect(budget.memorySource).toBe('default')
    expect(budget.memoryChars).toBe(2200)
  })

  it('a policy token budget reaches the store when the row has no explicit budget', async () => {
    const ctx = await context({ memoryChars: 4000, userChars: 900, memoryTokens: 10 })
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-policy-token-') })
    const budget = budgetOf(ctx) as unknown as Budget & { memoryTokens?: number; policyMemoryTokens?: number }
    expect(budget.memoryTokens).toBe(10)
    expect(budget.policyMemoryTokens).toBe(10)
    const first = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: '中'.repeat(10) }])
    expect(first).toMatchObject({ ok: true, tokens: 10, tokenLimit: 10 })
  })

  it('an opt-in token budget is used by the store and published on the budget surface', async () => {
    const ctx = await context()
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-token-budget-'), memoryTokens: 8 })
    const budget = budgetOf(ctx) as unknown as Budget & { memoryTokens?: number; memoryTokenSource?: string }
    expect(budget.memoryTokens).toBe(8)
    expect(budget.memoryTokenSource).toBe('config')
    const first = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: '中'.repeat(8) }])
    expect(first).toMatchObject({ ok: true, tokens: 8, tokenLimit: 8, limit: 8 })
    const over = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: '中' }])
    expect(over.ok).toBe(false)
    expect(over.message).toContain('tokens')
  })

  it('an EXPLICIT limit wins, and contradicting the policy warns once', async () => {
    const ctx = await context({ memoryChars: 2200, userChars: 1375 })
    // The spy must exist BEFORE the row mounts: the contradiction is reported
    // during assembly, not on first use.
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-'), memoryChars: 5000 })
    const budget = budgetOf(ctx)
    expect(budget.memoryChars).toBe(5000)
    expect(budget.memorySource).toBe('config')
    // The user limit was left unset, so it still follows the policy.
    expect(budget.userChars).toBe(1375)
    expect(budget.userSource).toBe('policy')
    const contradiction = warnSpy.mock.calls.filter(call => String(call[0]).includes('contradicts evolution-policy'))
    expect(contradiction).toHaveLength(1)
    // G1: the warn names the CANONICAL registry id (the row may spell either).
    expect(String(contradiction[0]![0])).toContain('memoryChars=5000')
  })

  it('an explicit value EQUAL to the policy is not a contradiction', async () => {
    const ctx = await context({ memoryChars: 4000, userChars: 1375 })
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-'), memoryChars: 4000 })
    const budget = budgetOf(ctx)
    expect(budget.memoryChars).toBe(4000)
    expect(budget.memorySource).toBe('config')
    expect(warnSpy.mock.calls.filter(call => String(call[0]).includes('contradicts evolution-policy'))).toHaveLength(0)
  })

  // G1: the canonical registry id is a live row field, so an explicit canonical
  // value must win exactly like the deprecated alias does — the old read compared
  // raw values and would have read the reference as absent.
  it('G1: an explicit CANONICAL row value wins through its live reference', async () => {
    const ctx = await context({ memoryChars: 2200, userChars: 1375 })
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-canonical-'), memoryChars: 5000 })
    const budget = budgetOf(ctx)
    expect(budget.memoryChars).toBe(5000)
    expect(budget.memorySource).toBe('config')
  })

  it('G3/S3.2 + G1: a user-layer budget wins, is reported as source user, and the STORE enforces it live', async () => {
    const ctx = await context({ memoryChars: 4000, userChars: 900 })
    provideSettings(ctx, { memoryChars: 30 })
    const userBudget = mutableVol<number | undefined>(30)
    MemoryFiles.apply(ctx, { root: await tempRoot('dsh-memory-user-'), memoryChars: userBudget.ref })
    const budget = budgetOf(ctx)
    expect(budget.memoryChars, 'the user layer is the highest-priority surface').toBe(30)
    expect(budget.memorySource).toBe('user')
    expect(budget.userChars, 'an unset key still follows the policy').toBe(900)
    expect(budget.userSource).toBe('policy')
    // The store itself must judge by the user value: a 40-char entry is refused
    // against the 30-char limit the user set, not the policy's 4000.
    const refused = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: 'x'.repeat(40) }])
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('30')
    // Live: the value is read at USE time, so the platform committing a new one
    // rebuilds the store on the next operation — no restart and no watcher.
    userBudget.set(4000)
    const accepted = await ctx.memory.applyBatch('memory', [{ action: 'add', facts: 'y'.repeat(40) }])
    expect(accepted.ok).toBe(true)
  })

  it('an explicit canonical value is config even when it equals the policy value', async () => {
    const ctx = await context({ memoryChars: 2200, userChars: 1375 })
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-'), memoryChars: 2200 })
    const budget = budgetOf(ctx)
    expect(budget.memorySource).toBe('config')
    expect(budget.memoryChars).toBe(2200)
  })
})
