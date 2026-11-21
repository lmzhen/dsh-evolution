// @tier fast
import { mkdtemp, rm, symlink } from 'node:fs/promises'
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
      expect((second.value as { message?: string }).message ?? '').toContain('SKILL_STALE_VERSION')
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

  it('keeps a parent read and a review-child read as separate owners', async () => {
    const { ctx, root } = await setup()
    const parent = agent()
    const child = agent()
    try {
      await call(ctx, parent, { action: 'create', name: 'owner-skill', content: skill('owner-skill', 'one') }, 'owner-create')
      const path = join(root, 'skills', 'owner-skill', 'SKILL.md')
      emitRead(ctx, parent, path)

      const childUnread = await call(ctx, child, { action: 'update', name: 'owner-skill', content: skill('owner-skill', 'child') }, 'owner-child-unread')
      expect((childUnread.value as { ok?: boolean }).ok).toBe(false)
      expect((childUnread.value as { message?: string }).message ?? '').toContain('read the skill target before writing it')

      emitRead(ctx, child, path)
      const childWrite = await call(ctx, child, { action: 'update', name: 'owner-skill', content: skill('owner-skill', 'child') }, 'owner-child-write')
      expect((childWrite.value as { ok?: boolean }).ok).toBe(true)

      const parentStale = await call(ctx, parent, { action: 'update', name: 'owner-skill', content: skill('owner-skill', 'parent') }, 'owner-parent-stale')
      expect((parentStale.value as { ok?: boolean }).ok).toBe(false)
      expect((parentStale.value as { message?: string }).message ?? '').toContain('读取之后被改动过')
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
      expect((removed.value as { ok?: boolean; message?: string }).ok, (removed.value as { message?: string }).message).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

  it('requires an observation for support patching and section patching', async () => {
    const { ctx, root } = await setup()
    const ownerA = agent()
    const ownerB = agent()
    try {
      await call(ctx, ownerA, { action: 'create', name: 'patch-gate', content: skill('patch-gate', '## Details\nold') }, 'patch-gate-create')
      const wrote = await call(ctx, ownerA, { action: 'write_file', name: 'patch-gate', file_path: 'references/a.md', file_content: 'support' }, 'patch-gate-write')
      expect((wrote.value as { ok?: boolean }).ok).toBe(true)

      const unreadSupport = await call(ctx, ownerB, { action: 'patch', summary: 'test patch', name: 'patch-gate', file_path: 'references/a.md', old_string: 'support', new_string: 'changed' }, 'patch-support-unread')
      expect((unreadSupport.value as { ok?: boolean }).ok).toBe(false)
      expect((unreadSupport.value as { message?: string }).message ?? '').toContain('read the skill target before writing it')

      const unreadSection = await call(ctx, ownerB, { action: 'patch', summary: 'test patch', name: 'patch-gate', section: { heading: 'Details', content: 'changed' } }, 'patch-section-unread')
      expect((unreadSection.value as { ok?: boolean }).ok).toBe(false)
      expect((unreadSection.value as { message?: string }).message ?? '').toContain('read the skill target before writing it')

      emitRead(ctx, ownerB, join(root, 'skills', 'patch-gate', 'references', 'a.md'))
      const support = await call(ctx, ownerB, { action: 'patch', summary: 'test patch', name: 'patch-gate', file_path: 'references/a.md', old_string: 'support', new_string: 'changed' }, 'patch-support-observed')
      expect((support.value as { ok?: boolean; message?: string }).ok, (support.value as { message?: string }).message).toBe(true)

      emitRead(ctx, ownerB, join(root, 'skills', 'patch-gate', 'SKILL.md'))
      const section = await call(ctx, ownerB, { action: 'patch', summary: 'test patch', name: 'patch-gate', section: { heading: 'Details', content: 'new section' } }, 'patch-section-observed')
      expect((section.value as { ok?: boolean }).ok).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

  it('serializes two owners patching the same support file from the same observation (K2)', async () => {
    const { ctx, root } = await setup()
    const ownerA = agent()
    const ownerB = agent()
    try {
      await call(ctx, ownerA, { action: 'create', name: 'patch-race', content: skill('patch-race', 'body') }, 'patch-race-create')
      await call(ctx, ownerA, { action: 'write_file', name: 'patch-race', file_path: 'references/race.md', file_content: 'alpha\nbeta\n' }, 'patch-race-write')
      const path = join(root, 'skills', 'patch-race', 'references', 'race.md')
      emitRead(ctx, ownerA, path)
      emitRead(ctx, ownerB, path)
      const [a, b] = await Promise.all([
        call(ctx, ownerA, { action: 'patch', summary: 'race A', name: 'patch-race', file_path: 'references/race.md', old_string: 'alpha', new_string: 'ALPHA' }, 'patch-race-a'),
        call(ctx, ownerB, { action: 'patch', summary: 'race B', name: 'patch-race', file_path: 'references/race.md', old_string: 'beta', new_string: 'BETA' }, 'patch-race-b'),
      ])
      const okA = (a.value as { ok?: boolean }).ok === true
      const okB = (b.value as { ok?: boolean }).ok === true
      expect([okA, okB].filter(Boolean)).toHaveLength(1)
      const failure = (okA ? b.value : a.value) as { message?: string }
      expect(failure.message ?? '').toContain('SKILL_STALE_VERSION')
      const content = await (await import('node:fs/promises')).readFile(path, 'utf8')
      expect(content).toBe(okA ? 'ALPHA\nbeta\n' : 'alpha\nBETA\n')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

  it('treats a directory alias as the same support target for lock and observation (K7)', async () => {
    const { ctx, root } = await setup()
    const ownerA = agent()
    const ownerB = agent()
    try {
      await call(ctx, ownerA, { action: 'create', name: 'alias-race', content: skill('alias-race', 'body') }, 'alias-race-create')
      await call(ctx, ownerA, { action: 'write_file', name: 'alias-race', file_path: 'references/real.md', file_content: 'alpha\nbeta\n' }, 'alias-race-write')
      await symlink(join(root, 'skills', 'alias-race', 'references'), join(root, 'skills', 'alias-race', 'alias-dir'), process.platform === 'win32' ? 'junction' : 'dir')
      emitRead(ctx, ownerA, join(root, 'skills', 'alias-race', 'references', 'real.md'))
      emitRead(ctx, ownerB, join(root, 'skills', 'alias-race', 'alias-dir', 'real.md'))
      const [a, b] = await Promise.all([
        call(ctx, ownerA, { action: 'patch', summary: 'alias A', name: 'alias-race', file_path: 'references/real.md', old_string: 'alpha', new_string: 'ALPHA' }, 'alias-race-a'),
        call(ctx, ownerB, { action: 'patch', summary: 'alias B', name: 'alias-race', file_path: 'alias-dir/real.md', old_string: 'beta', new_string: 'BETA' }, 'alias-race-b'),
      ])
      const okA = (a.value as { ok?: boolean }).ok === true
      const okB = (b.value as { ok?: boolean }).ok === true
      expect([okA, okB].filter(Boolean)).toHaveLength(1)
      const content = await (await import('node:fs/promises')).readFile(join(root, 'skills', 'alias-race', 'references', 'real.md'), 'utf8')
      expect(content).toBe(okA ? 'ALPHA\nbeta\n' : 'alpha\nBETA\n')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

  it('allows exactly one concurrent tool create of the same skill (K8)', async () => {
    const { ctx, root } = await setup()
    const ownerA = agent()
    const ownerB = agent()
    try {
      const [a, b] = await Promise.all([
        call(ctx, ownerA, { action: 'create', name: 'create-skill-race', content: skill('create-skill-race', 'from A') }, 'create-skill-race-a'),
        call(ctx, ownerB, { action: 'create', name: 'create-skill-race', content: skill('create-skill-race', 'from B') }, 'create-skill-race-b'),
      ])
      const okA = (a.value as { ok?: boolean }).ok === true
      const okB = (b.value as { ok?: boolean }).ok === true
      expect([okA, okB].filter(Boolean)).toHaveLength(1)
      const loser = okA ? b : a
      expect((loser.value as { message?: string }).message ?? '').toContain('SKILL_ALREADY_EXISTS')
      const content = await (await import('node:fs/promises')).readFile(join(root, 'skills', 'create-skill-race', 'SKILL.md'), 'utf8')
      expect(content).toContain(okA ? 'from A' : 'from B')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

  it('allows one concurrent create of the same absent support file', async () => {
    const { ctx, root } = await setup()
    const ownerA = agent()
    const ownerB = agent()
    try {
      await call(ctx, ownerA, { action: 'create', name: 'create-race', content: skill('create-race', 'body') }, 'create-race-create')
      const options = { action: 'write_file', name: 'create-race', file_path: 'references/a.md' }
      const [a, b] = await Promise.all([
        call(ctx, ownerA, { ...options, file_content: 'from A' }, 'create-race-a'),
        call(ctx, ownerB, { ...options, file_content: 'from B' }, 'create-race-b'),
      ])
      const okA = (a.value as { ok?: boolean }).ok === true
      const okB = (b.value as { ok?: boolean }).ok === true
      expect([okA, okB].filter(Boolean)).toHaveLength(1)
      const content = await (await import('node:fs/promises')).readFile(join(root, 'skills', 'create-race', 'references', 'a.md'), 'utf8')
      expect(content).toBe(okA ? 'from A' : 'from B')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 30_000)

})
