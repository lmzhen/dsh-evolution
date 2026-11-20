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
  it('records create as an observation and keeps the service path for the same owner', async () => {
    const { ctx, root } = await setup()
    const owner = agent()
    try {
      const created = await call(ctx, owner, { action: 'create', name: 'obs-skill', content: skill('obs-skill', 'one') }, 'obs-create')
      expect((created.value as { ok?: boolean }).ok).toBe(true)

      // Create records the new content, so the same owner can update without a
      // separate read before the observation-derived service path.
      const afterCreate = await call(ctx, owner, { action: 'update', name: 'obs-skill', content: skill('obs-skill', 'after-create') }, 'obs-after-create')
      expect((afterCreate.value as { ok?: boolean }).ok).toBe(true)

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
  it('refuses an update from a session that never read the skill', async () => {
    const { ctx, root } = await setup()
    const ownerA = agent()
    const ownerB = agent()
    try {
      await call(ctx, ownerA, { action: 'create', name: 'unread-skill', content: skill('unread-skill', 'one') }, 'unread-create')
      const result = await call(ctx, ownerB, { action: 'update', name: 'unread-skill', content: skill('unread-skill', 'two') }, 'unread-update')
      expect((result.value as { ok?: boolean }).ok).toBe(false)
      expect((result.value as { message?: string }).message ?? '').toContain('read the skill target before writing it')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

  it('removes a support file only for the owner that observed it', async () => {
    const { ctx, root } = await setup()
    const ownerA = agent()
    const ownerB = agent()
    try {
      await call(ctx, ownerA, { action: 'create', name: 'remove-skill', content: skill('remove-skill', 'one') }, 'remove-create')
      const written = await call(ctx, ownerA, { action: 'write_file', name: 'remove-skill', file_path: 'references/a.md', file_content: 'support' }, 'remove-write')
      expect((written.value as { ok?: boolean }).ok).toBe(true)

      const unread = await call(ctx, ownerB, { action: 'remove_file', name: 'remove-skill', file_path: 'references/a.md' }, 'remove-unread')
      expect((unread.value as { ok?: boolean }).ok).toBe(false)
      expect((unread.value as { message?: string }).message ?? '').toContain('read the skill target before writing it')

      const removed = await call(ctx, ownerA, { action: 'remove_file', name: 'remove-skill', file_path: 'references/a.md' }, 'remove-observed')
      expect((removed.value as { ok?: boolean }).ok).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

})
