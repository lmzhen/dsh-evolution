// @tier ci-only
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as searchEntry from '../src/search-entry.ts'

it('registers skill_search without domain/projection services', async () => {
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  expect(ctx.get('workingDirectory')).toBeDefined()
  expect(ctx.get('skills')).toBeDefined()
  await ctx.plugin(searchEntry, { featureEpoch: 'search-only', mode: 'off' })
  expect(ctx.get('tools')?.get('skill_search')).toBeDefined()
})

it('honors searchEnabled=false as a no-tool surface', async () => {
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(searchEntry, { featureEpoch: 'search-only', searchEnabled: false })
  expect(ctx.get('tools')?.get('skill_search')).toBeUndefined()
})
