import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { skillBodyTarget, skillSupportTarget } from '@deepseek-ai/dsh-evolution-core/skills'
import { installSkillObservationListener, skillPlatformVersion } from '../src/skill-observations.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skill-observations-'))
  roots.push(root)
  return root
}

async function writeSkillFile(root: string, rel: string, content: string): Promise<string> {
  const path = join(root, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf8')
  return path
}

function fsTarget(path: string): FsTarget {
  return { targetKey: path, displayPath: path } as FsTarget
}

function emitRead(ctx: Context, path: string, actor: object | undefined): void {
  const version = skillPlatformVersion(path)
  expect(version).toBeDefined()
  ctx.emit('fs/observed', fsTarget(path), { kind: 'present', version: version! }, actor)
}

describe('skill fs observation listener', () => {
  it('records the content hash for the exact session owner', async () => {
    const ctx = new Context()
    const root = await makeRoot()
    const store = installSkillObservationListener(ctx, root)
    const bodyPath = await writeSkillFile(root, 'my-skill/SKILL.md', 'body')
    const supportPath = await writeSkillFile(root, 'my-skill/references/a.md', 'support')
    const owner = { agent: { session: {} } }

    emitRead(ctx, bodyPath, owner)
    emitRead(ctx, supportPath, owner)

    expect(store.requirePresent(owner.agent.session, skillBodyTarget('my-skill'))).toEqual({
      version: contentHash('body'),
    })
    expect(store.requirePresent(owner.agent.session, skillSupportTarget('my-skill', 'references/a.md'))).toEqual({
      version: contentHash('support'),
    })
  })

  it('does not share an observation with another session', async () => {
    const ctx = new Context()
    const root = await makeRoot()
    const store = installSkillObservationListener(ctx, root)
    const path = await writeSkillFile(root, 'my-skill/SKILL.md', 'body')
    const ownerA = { agent: { session: {} } }
    const ownerB = { agent: { session: {} } }

    emitRead(ctx, path, ownerA)

    expect(store.requirePresent(ownerA.agent.session, skillBodyTarget('my-skill'))).toBeDefined()
    expect(store.requirePresent(ownerB.agent.session, skillBodyTarget('my-skill'))).toEqual({ kind: 'unobserved' })
  })

  it('ignores non-skill paths, absent observations, and actor-less events', async () => {
    const ctx = new Context()
    const root = await makeRoot()
    const store = installSkillObservationListener(ctx, root)
    const loose = await writeSkillFile(root, 'README.md', 'loose')
    const bodyPath = await writeSkillFile(root, 'my-skill/SKILL.md', 'body')
    const owner = { agent: { session: {} } }

    emitRead(ctx, loose, owner)
    ctx.emit('fs/observed', fsTarget(bodyPath), { kind: 'absent' }, owner)
    emitRead(ctx, bodyPath, undefined)

    expect(store.requirePresent(owner.agent.session, skillBodyTarget('my-skill'))).toEqual({ kind: 'unobserved' })
  })

  it('does not record when the platform version is stale for the current bytes', async () => {
    const ctx = new Context()
    const root = await makeRoot()
    const store = installSkillObservationListener(ctx, root)
    const path = await writeSkillFile(root, 'my-skill/SKILL.md', 'old')
    const owner = { agent: { session: {} } }
    const oldVersion = skillPlatformVersion(path)

    await writeFile(path, 'new', 'utf8')
    ctx.emit('fs/observed', fsTarget(path), { kind: 'present', version: oldVersion! }, owner)

    expect(store.requirePresent(owner.agent.session, skillBodyTarget('my-skill'))).toEqual({ kind: 'unobserved' })
  })
  it('clears every observation when the plugin context disposes (HMR)', async () => {
    const ctx = new Context()
    const root = await makeRoot()
    const store = installSkillObservationListener(ctx, root)
    const path = await writeSkillFile(root, 'my-skill/SKILL.md', 'body')
    const owner = { agent: { session: {} } }
    emitRead(ctx, path, owner)
    expect(store.requirePresent(owner.agent.session, skillBodyTarget('my-skill'))).toBeDefined()

    await ctx.fiber.dispose()

    expect(store.requirePresent(owner.agent.session, skillBodyTarget('my-skill'))).toEqual({ kind: 'unobserved' })
  })

})
