// @tier ci-only
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import EvolutionIoRegistry from '../../evolution-io/src/index.ts'
import * as mainEntry from '../src/main-entry.ts'

async function base(): Promise<Context> {
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider({ name: 'fake', readText: async () => null, writeText: async () => {}, remove: async () => {}, list: async () => [], exists: async () => false, rename: async () => {}, copy: async () => {} })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
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
