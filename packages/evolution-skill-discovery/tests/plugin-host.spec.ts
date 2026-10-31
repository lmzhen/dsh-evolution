// @tier ci-only
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import EvolutionIoRegistry from '../../evolution-io/src/index.ts'
import * as discoveryPlugin from '../src/plugin.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

it('mounts the discovery plugin through real services', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-discovery-plugin-')); dirs.push(dir)
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx, dir)
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider({ name: 'fake', readText: async () => null, writeText: async () => {}, remove: async () => {}, list: async () => [], exists: async () => false, rename: async () => {}, copy: async () => {} })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: join(dir, '.dsh'), agentsHome: join(dir, '.agents'), watch: false })
  await ctx.plugin(toolSkill)
  await ctx.plugin(discoveryPlugin, { domainMapPath: join(dir, 'domain-map.json'), sessionPath: join(dir, 'sessions.json'), featureEpoch: 'epoch-1', mode: 'on' })
  expect(ctx.get('tools')?.get('skill_search')).toBeDefined()
  expect(ctx.get('systemPrompt')).toBeDefined()
})


it('registers and handles the skill-domain command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-discovery-command-')); dirs.push(dir)
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx, dir)
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider({ name: 'fake', readText: async () => null, writeText: async () => {}, remove: async () => {}, list: async () => [], exists: async () => false, rename: async () => {}, copy: async () => {} })
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: join(dir, '.dsh'), agentsHome: join(dir, '.agents'), watch: false })
  await ctx.plugin(toolSkill)
  let definition: { name: string; handler: (input: { rawInput: string }) => Promise<{ kind: string; text?: string }> } | undefined
  ctx.provide('commands', { register: (input: typeof definition) => { definition = input; return () => {} } })
  await ctx.plugin(discoveryPlugin, { domainMapPath: join(dir, 'map.json'), sessionPath: join(dir, 'sessions.json'), featureEpoch: 'e', mode: 'on' })
  expect(definition?.name).toBe('skill-domain')
  expect(await definition!.handler({ rawInput: 'list' })).toMatchObject({ kind: 'success' })
  expect(await definition!.handler({ rawInput: 'confirm missing' })).toMatchObject({ kind: 'error' })
})
