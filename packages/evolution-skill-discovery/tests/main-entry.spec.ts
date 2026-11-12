// @tier ci-only
import { expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { executeOne, mountToolHost } from '../../test-support/tool-host.ts'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import EvolutionIoRegistry from '../../evolution-core/src/io-registry.ts'
import * as mainEntry from '../src/main-entry.ts'

async function base(): Promise<Context> {
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider({ name: 'fake', readText: async () => null, writeText: async () => {}, remove: async () => {}, list: async () => [], exists: async () => false, rename: async () => {}, copy: async () => {} })
  await mountToolHost(ctx, { session: false })
  await ctx.plugin(SkillRegistry)
  return ctx
}

it('fails loud when mode:on has no llm', async () => {
  const ctx = await base()
  await expect(ctx.plugin(mainEntry, { featureEpoch: 'e', mode: 'on', searchEnabled: true })).rejects.toThrow(/requires an llm/)
})

it('exposes no search tool when searchEnabled is false', async () => {
  const ctx = await base()
  await ctx.plugin(mainEntry, { featureEpoch: 'e', mode: 'off', searchEnabled: false })
  expect(ctx.get('tools')?.get('skill_search')).toBeUndefined()
})

it('executes skill_search in mode:off without policy TDZ', async () => {
  const ctx = await base()
  await ctx.plugin(mainEntry, { featureEpoch: 'e', mode: 'off', searchEnabled: true })
  const agent = { id: 'search-agent', session: { id: 'search-session', header: { cwd: process.cwd() } } } as unknown as Agent
  const result = await executeOne(ctx, { signal: new AbortController().signal, callId: ToolCallId('mode-off-search'), name: 'skill_search', arguments: { query: 'anything' }, agent })
  const text = JSON.stringify(result.content)
  expect(text).toContain('Found 0 skill result(s)')
  expect(text).not.toContain('degraded')
})
