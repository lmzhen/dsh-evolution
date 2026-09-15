/**
 * S2-12③ (FLOW5-4): the memory budget's two configuration surfaces.
 *
 * `memory-files`' store limit and `evolution-policy`'s `memoryChars`/`userChars`
 * used to default independently, so moving one left the other behind: the review
 * planned ops for a budget the store then refused. An UNSET limit now follows the
 * mounted policy, an explicit contradiction warns once, and the effective budget
 * (+ which surface won) is published as `evolutionMemoryBudget` for doctor.
 *
 * "Unset" is read as "equal to the schema default": the loader fills defaults
 * into the row config, so a row that pins the default value explicitly is
 * indistinguishable from one that omits it (documented in the package README).
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as MemoryFiles from '../src/index.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

interface Budget {
  memoryCharLimit: number
  userCharLimit: number
  memorySource: string
  userSource: string
}

async function context(policy?: { memoryChars: number; userChars: number }) {
  const ctx = new Context()
  await ctx.plugin(MemoryRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  if (policy !== undefined) ctx.provide('evolutionPolicy', { get: () => policy })
  return ctx
}

const budgetOf = (ctx: Context): Budget =>
  (ctx as unknown as { get(name: string): unknown }).get('evolutionMemoryBudget') as Budget

describe('memory budget surfaces (S2-12③)', () => {
  it('an UNSET limit follows the mounted policy, and says so', async () => {
    const ctx = await context({ memoryChars: 4000, userChars: 900 })
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-') })
    const budget = budgetOf(ctx)
    expect(budget.memoryCharLimit).toBe(4000)
    expect(budget.userCharLimit).toBe(900)
    expect(budget.memorySource).toBe('policy')
    expect(budget.userSource).toBe('policy')
  })

  it('without a policy an UNSET limit keeps the package default', async () => {
    const ctx = await context()
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-') })
    const budget = budgetOf(ctx)
    expect(budget.memorySource).toBe('default')
    expect(budget.memoryCharLimit).toBe(2200)
  })

  it('an EXPLICIT limit wins, and contradicting the policy warns once', async () => {
    const ctx = await context({ memoryChars: 2200, userChars: 1375 })
    // The spy must exist BEFORE the row mounts: the contradiction is reported
    // during assembly, not on first use.
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-'), memoryCharLimit: 5000 })
    const budget = budgetOf(ctx)
    expect(budget.memoryCharLimit).toBe(5000)
    expect(budget.memorySource).toBe('config')
    // The user limit was left unset, so it still follows the policy.
    expect(budget.userCharLimit).toBe(1375)
    expect(budget.userSource).toBe('policy')
    const contradiction = warnSpy.mock.calls.filter(call => String(call[0]).includes('contradicts evolution-policy'))
    expect(contradiction).toHaveLength(1)
    expect(String(contradiction[0]![0])).toContain('memoryCharLimit=5000')
  })

  it('an explicit value EQUAL to the policy is not a contradiction', async () => {
    const ctx = await context({ memoryChars: 4000, userChars: 1375 })
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-'), memoryCharLimit: 4000 })
    const budget = budgetOf(ctx)
    expect(budget.memoryCharLimit).toBe(4000)
    expect(budget.memorySource).toBe('config')
    expect(warnSpy.mock.calls.filter(call => String(call[0]).includes('contradicts evolution-policy'))).toHaveLength(0)
  })

  it('a value equal to the SCHEMA DEFAULT is treated as unset (documented limitation)', async () => {
    const ctx = await context({ memoryChars: 2200, userChars: 1375 })
    await ctx.plugin(MemoryFiles, { root: await tempRoot('dsh-memory-budget-'), memoryCharLimit: 2200 })
    const budget = budgetOf(ctx)
    // Indistinguishable from an omitted value — the loader fills the default in.
    expect(budget.memorySource).toBe('policy')
    expect(budget.memoryCharLimit).toBe(2200)
  })
})
