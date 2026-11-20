import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SkillUsageRegistry from '@deepseek-ai/dsh-evolution-skill-discovery/usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-core/io-registry'
import * as NodeIo from '@deepseek-ai/dsh-evolution-core/io-node'
import * as ToolSkillManage from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { executeOne } from '../../test-support/tool-executor.ts'
import { skillPlatformVersion } from '../src/skill-observations.ts'

const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: A sufficiently long description for the observed write test.\n---\n\n${body}\n`

function agent(): Agent {
  return { session: { header: {}, append: () => {} } } as unknown as Agent
}

async function setup(): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'skill-observed-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(SkillUsageRegistry, { root })
  ctx.provide('evolutionPlatform', { ports: { systemPrompt: ctx.systemPrompt } })
  await ctx.plugin(ToolSkillManage)
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  return { ctx, root }
}

async function call(ctx: Context, owner: Agent, args: Record<string, unknown>, id: string) {
  return await executeOne(ctx, {
    callId: ToolCallId(id),
    name: 'skill_manage',
    arguments: args,
    agent: owner,
    signal: new AbortController().signal,
  })
}

function emitRead(ctx: Context, owner: Agent, path: string): void {
  const version = skillPlatformVersion(path)
  expect(version).toBeDefined()
  ctx.emit(
    'fs/observed',
    { targetKey: path, displayPath: path } as never,
    { kind: 'present', version: version! },
    { agent: owner },
  )
}

describe('tool observed writes', () => {
  it('uses the service after the exact owner reads, and falls back before any observation', async () => {
    const { ctx, root } = await setup()
    const owner = agent()
    try {
      const created = await call(ctx, owner, { action: 'create', name: 'obs-skill', content: skill('obs-skill', 'one') }, 'obs-create')
      expect((created.value as { ok?: boolean }).ok).toBe(true)

      // No observation: the transitional fallback keeps the old write behavior.
      const fallback = await call(ctx, owner, { action: 'update', name: 'obs-skill', content: skill('obs-skill', 'fallback') }, 'obs-fallback')
      expect((fallback.value as { ok?: boolean }).ok).toBe(true)

      const path = join(root, 'skills', 'obs-skill', 'SKILL.md')
      emitRead(ctx, owner, path)
      const observed = await call(ctx, owner, { action: 'update', name: 'obs-skill', content: skill('obs-skill', 'observed') }, 'obs-observed')
      expect((observed.value as { ok?: boolean }).ok).toBe(true)
      expect(await import('node:fs/promises').then(fs => fs.readFile(path, 'utf8'))).toContain('observed')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

  it('makes the second writer stale when two owners observed the same version', async () => {
    const { ctx, root } = await setup()
    const ownerA = agent()
    const ownerB = agent()
    try {
      await call(ctx, ownerA, { action: 'create', name: 'stale-skill', content: skill('stale-skill', 'one') }, 'stale-create')
      const path = join(root, 'skills', 'stale-skill', 'SKILL.md')
      emitRead(ctx, ownerA, path)
      emitRead(ctx, ownerB, path)

      const first = await call(ctx, ownerA, { action: 'update', name: 'stale-skill', content: skill('stale-skill', 'A') }, 'stale-a')
      const second = await call(ctx, ownerB, { action: 'update', name: 'stale-skill', content: skill('stale-skill', 'B') }, 'stale-b')
      expect((first.value as { ok?: boolean }).ok).toBe(true)
      expect((second.value as { ok?: boolean }).ok).toBe(false)
      expect((second.value as { message?: string }).message ?? '').toContain('读取之后被改动过')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)
})
