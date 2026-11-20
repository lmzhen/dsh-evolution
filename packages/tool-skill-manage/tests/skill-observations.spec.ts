import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { skillBodyTarget, skillSupportTarget } from '@deepseek-ai/dsh-evolution-core/skills'
import { installSkillObservationListener } from '../src/skill-observations.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skill-observations-'))
  roots.push(root)
  return root
}

function fsTarget(path: string): FsTarget {
  return { targetKey: path, displayPath: path } as FsTarget
}

describe('skill fs observation listener', () => {
  it('records the read version for the exact session owner', async () => {
    const ctx = new Context()
    const root = await makeRoot()
    const store = installSkillObservationListener(ctx, root)
    const body = skillBodyTarget('my-skill')
    const support = skillSupportTarget('my-skill', 'references/a.md')
    const owner = { agent: { session: {} } }

    ctx.emit('fs/observed', fsTarget(join(root, 'my-skill', 'SKILL.md')), { kind: 'present', version: 'v-body' }, owner)
    ctx.emit('fs/observed', fsTarget(join(root, 'my-skill', 'references', 'a.md')), { kind: 'present', version: 'v-support' }, owner)

    expect(store.requirePresent(owner.agent.session, body)).toEqual({ version: 'v-body' })
    expect(store.requirePresent(owner.agent.session, support)).toEqual({ version: 'v-support' })

  })

  it('does not share an observation with another session', async () => {
    const ctx = new Context()
    const root = await makeRoot()
    const store = installSkillObservationListener(ctx, root)
    const target = skillBodyTarget('my-skill')
    const ownerA = { agent: { session: {} } }
    const ownerB = { agent: { session: {} } }

    ctx.emit('fs/observed', fsTarget(join(root, 'my-skill', 'SKILL.md')), { kind: 'present', version: 'v1' }, ownerA)

    expect(store.requirePresent(ownerA.agent.session, target)).toEqual({ version: 'v1' })
    expect(store.requirePresent(ownerB.agent.session, target)).toEqual({ kind: 'unobserved' })
  })

  it('ignores non-skill paths, absent observations, and actor-less events', async () => {
    const ctx = new Context()
    const root = await makeRoot()
    const store = installSkillObservationListener(ctx, root)
    const owner = { agent: { session: {} } }

    ctx.emit('fs/observed', fsTarget(join(root, 'README.md')), { kind: 'present', version: 'loose' }, owner)
    ctx.emit('fs/observed', fsTarget(join(root, 'my-skill', 'SKILL.md')), { kind: 'absent' }, owner)
    ctx.emit('fs/observed', fsTarget(join(root, 'my-skill', 'SKILL.md')), { kind: 'present', version: 'no-owner' }, undefined)

    expect(store.requirePresent(owner.agent.session, skillBodyTarget('my-skill'))).toEqual({ kind: 'unobserved' })
  })
})
