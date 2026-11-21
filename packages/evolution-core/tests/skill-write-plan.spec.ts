// @tier pre-tag
/**
 * H1: the plan seam maps domain ops onto the existing mutators without
 * changing tool behavior. Multi-op plans are intentionally refused until the
 * UnitTransaction phase; a partial commit here would be worse than no API.
 */
import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import { SkillLibrary, skillBodyTarget, skillSupportTarget } from '@deepseek-ai/dsh-evolution-core/skills'

const body = (name: string, text = 'Body.'): string => `---\nname: ${name}\ndescription: plan seam fixture\n---\n${text}\n`

async function setup(): Promise<{ root: string; lib: SkillLibrary }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolution-plan-'))
  return { root, lib: new SkillLibrary(root) }
}

it('applies one write/patch/patchSection op through the existing mutators', async () => {
  const { root, lib } = await setup()
  try {
    expect((await lib.create('plan-skill', body('plan-skill', 'seed'), 'foreground')).ok).toBe(true)
    const target = skillBodyTarget('plan-skill')
    const initial = body('plan-skill', 'seed')

    const replaced = await lib.apply({
      origin: 'foreground',
      ops: [{ kind: 'write', target, content: body('plan-skill', 'updated'), expect: { kind: 'present', version: contentHash(initial) } }],
    })
    expect(replaced.ok).toBe(true)
    expect(await lib.read('plan-skill')).toContain('updated')

    const patched = await lib.apply({
      origin: 'foreground',
      ops: [{
        kind: 'patch',
        target,
        oldString: 'updated',
        newString: 'patched',
        replaceAll: false,
        expect: { kind: 'present', version: contentHash(body('plan-skill', 'updated')) },
      }],
    })
    expect(patched.ok).toBe(true)
    expect(await lib.read('plan-skill')).toContain('patched')

    const sectioned = await lib.apply({
      origin: 'foreground',
      ops: [{
        kind: 'patchSection',
        target,
        section: { heading: 'Details', content: 'new section' },
        expect: { kind: 'present', version: contentHash(body('plan-skill', 'patched')) },
      }],
    })
    // No ## Details heading exists, so the section op must be a structured refusal.
    expect(sectioned.ok).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('uses createIfAbsent for a new support file and rejects a second create', async () => {
  const { root, lib } = await setup()
  try {
    expect((await lib.create('support-plan', body('support-plan'), 'foreground')).ok).toBe(true)
    const target = skillSupportTarget('support-plan', 'references/note.md')
    const first = await lib.apply({
      origin: 'foreground',
      ops: [{ kind: 'write', target, content: 'one', expect: { kind: 'absent' } }],
    })
    expect(first.ok).toBe(true)
    const second = await lib.apply({
      origin: 'foreground',
      ops: [{ kind: 'write', target, content: 'two', expect: { kind: 'absent' } }],
    })
    expect(second.ok).toBe(false)
    expect(await readFile(join(root, 'support-plan', 'references/note.md'), 'utf8')).toBe('one')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('creates a skill only through the explicit createSkill op', async () => {
  const { root, lib } = await setup()
  try {
    const created = await lib.apply({
      origin: 'foreground',
      ops: [{ kind: 'createSkill', skill: 'created-by-plan', content: body('created-by-plan') }],
    })
    expect(created.ok).toBe(true)
    expect(await lib.read('created-by-plan')).toContain('Body.')

    const second = await lib.apply({
      origin: 'foreground',
      ops: [{ kind: 'createSkill', skill: 'created-by-plan', content: body('created-by-plan', 'other') }],
    })
    expect(second.ok).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses a multi-op plan until the unit phase is implemented', async () => {
  const { root, lib } = await setup()
  try {
    const target = skillBodyTarget('missing')
    const result = await lib.apply({
      origin: 'foreground',
      ops: [
        { kind: 'write', target, content: body('missing'), expect: { kind: 'absent' } },
        { kind: 'write', target, content: body('missing', 'second'), expect: { kind: 'absent' } },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('multi-op')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
