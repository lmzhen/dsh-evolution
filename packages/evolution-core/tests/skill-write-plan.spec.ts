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
import { SkillLibrary, SystemSkillWriter, skillBodyTarget, skillSupportTarget } from '@deepseek-ai/dsh-evolution-core/skills'

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

it('applies a multi-op plan through one atomic unit and leaves all targets untouched on one stale anchor', async () => {
  const { root, lib } = await setup()
  try {
    expect((await lib.create('multi-plan', body('multi-plan'), 'foreground')).ok).toBe(true)
    const a = skillSupportTarget('multi-plan', 'references/a.md')
    const b = skillSupportTarget('multi-plan', 'references/b.md')
    const applied = await lib.apply({
      origin: 'foreground',
      ops: [
        { kind: 'write', target: a, content: 'A', expect: { kind: 'absent' } },
        { kind: 'write', target: b, content: 'B', expect: { kind: 'absent' } },
      ],
    })
    expect(applied.ok, applied.message).toBe(true)
    expect(applied.outcomes).toHaveLength(2)
    expect(await readFile(join(root, 'multi-plan', 'references', 'a.md'), 'utf8')).toBe('A')
    expect(await readFile(join(root, 'multi-plan', 'references', 'b.md'), 'utf8')).toBe('B')
    const stale = await lib.apply({
      origin: 'foreground',
      ops: [
        { kind: 'write', target: skillSupportTarget('multi-plan', 'references/c.md'), content: 'C', expect: { kind: 'absent' } },
        { kind: 'write', target: skillSupportTarget('multi-plan', 'references/d.md'), content: 'D', expect: { kind: 'present', version: contentHash('not-the-bytes') } },
      ],
    })
    expect(stale.ok).toBe(false)
    await expect(readFile(join(root, 'multi-plan', 'references', 'c.md'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(root, 'multi-plan', 'references', 'd.md'), 'utf8')).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('applies a body write and a support write in one multi-op unit, including remove', async () => {
  const { root, lib } = await setup()
  try {
    expect((await lib.create('multi-body', body('multi-body', 'old'), 'foreground')).ok).toBe(true)
    expect((await lib.writeSupportFile('multi-body', 'references/gone.md', 'gone', 'foreground')).ok).toBe(true)
    const old = body('multi-body', 'old')
    const applied = await lib.apply({
      origin: 'foreground',
      ops: [
        { kind: 'write', target: skillBodyTarget('multi-body'), content: body('multi-body', 'new'), expect: { kind: 'present', version: contentHash(old) } },
        { kind: 'write', target: skillSupportTarget('multi-body', 'references/added.md'), content: 'added', expect: { kind: 'absent' } },
        { kind: 'remove', target: skillSupportTarget('multi-body', 'references/gone.md'), expect: { kind: 'present', version: contentHash('gone') } },
      ],
    })
    expect(applied.ok, applied.message).toBe(true)
    expect(await lib.read('multi-body')).toContain('new')
    expect(await readFile(join(root, 'multi-body', 'references', 'added.md'), 'utf8')).toBe('added')
    await expect(readFile(join(root, 'multi-body', 'references', 'gone.md'), 'utf8')).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('creates a foreground skill together with a support file in one multi-op unit', async () => {
  const { root, lib } = await setup()
  try {
    const applied = await lib.apply({
      origin: 'foreground',
      ops: [
        { kind: 'createSkill', skill: 'multi-create', content: body('multi-create') },
        { kind: 'write', target: skillSupportTarget('multi-create', 'references/a.md'), content: 'a', expect: { kind: 'absent' } },
      ],
    })
    expect(applied.ok, applied.message).toBe(true)
    expect(await lib.read('multi-create')).toContain('Body.')
    expect(await readFile(join(root, 'multi-create', 'references', 'a.md'), 'utf8')).toBe('a')
    const created = (await lib.listMutations()).filter(entry => entry.skillName === 'multi-create' && entry.action === 'create')
    expect(created).toHaveLength(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('does not write a create audit when a later op in the same plan is refused', async () => {
  const { root, lib } = await setup()
  try {
    const refused = await lib.apply({
      origin: 'foreground',
      ops: [
        { kind: 'createSkill', skill: 'multi-phantom', content: body('multi-phantom') },
        { kind: 'write', target: skillSupportTarget('multi-phantom', 'references/a.md'), content: 'a', expect: { kind: 'present', version: contentHash('not-there') } },
      ],
    })
    expect(refused.ok).toBe(false)
    expect((await lib.listMutations()).filter(entry => entry.skillName === 'multi-phantom')).toHaveLength(0)
    await expect(readFile(join(root, 'multi-phantom', 'SKILL.md'), 'utf8')).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('applies a section patch and a support write in one multi-op unit', async () => {
  const { root, lib } = await setup()
  try {
    const original = '---\nname: multi-section\ndescription: section fixture\n---\n\n# multi-section\n\n## Details\nold\n'
    expect((await lib.create('multi-section', original, 'foreground')).ok).toBe(true)
    const applied = await lib.apply({
      origin: 'foreground',
      ops: [
        { kind: 'patchSection', target: skillBodyTarget('multi-section'), section: { heading: 'Details', content: 'new' }, expect: { kind: 'present', version: contentHash(original) } },
        { kind: 'write', target: skillSupportTarget('multi-section', 'references/a.md'), content: 'a', expect: { kind: 'absent' } },
      ],
    })
    expect(applied.ok, applied.message).toBe(true)
    expect(await lib.read('multi-section')).toContain('new')
    expect(await readFile(join(root, 'multi-section', 'references', 'a.md'), 'utf8')).toBe('a')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('keeps a no-op op in a multi-op plan while committing the changed one', async () => {
  const { root, lib } = await setup()
  try {
    const current = body('multi-noop')
    expect((await lib.create('multi-noop', current, 'foreground')).ok).toBe(true)
    const applied = await lib.apply({
      origin: 'foreground',
      ops: [
        { kind: 'write', target: skillBodyTarget('multi-noop'), content: current, expect: { kind: 'present', version: contentHash(current) } },
        { kind: 'write', target: skillSupportTarget('multi-noop', 'references/a.md'), content: 'a', expect: { kind: 'absent' } },
      ],
    })
    expect(applied.ok, applied.message).toBe(true)
    expect(applied.outcomes[0]?.noop).toBe(true)
    expect(await readFile(join(root, 'multi-noop', 'references', 'a.md'), 'utf8')).toBe('a')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('reports the on-disk patch bytes in the outcome (P1-1)', async () => {
  const { root, lib } = await setup()
  try {
    expect((await lib.create('after-skill', body('after-skill', 'seed'), 'foreground')).ok).toBe(true)
    expect((await lib.writeSupportFile('after-skill', 'references/a.md', 'line\n\n\n', 'foreground')).ok).toBe(true)
    const before = await lib.readSupportFile('after-skill', 'references/a.md')
    expect(before).not.toBeNull()
    const patched = await lib.apply({
      origin: 'foreground',
      ops: [{ kind: 'patch', target: skillSupportTarget('after-skill', 'references/a.md'), oldString: 'line', newString: 'line2', replaceAll: false, expect: { kind: 'present', version: contentHash(before!) } }],
    })
    expect(patched.ok).toBe(true)
    expect(patched.outcomes[0]?.after).toBe('line2\n')
    expect(await lib.readSupportFile('after-skill', 'references/a.md')).toBe('line2\n')
    const second = await lib.apply({
      origin: 'foreground',
      ops: [{ kind: 'patch', target: skillSupportTarget('after-skill', 'references/a.md'), oldString: 'line2', newString: 'line3', replaceAll: false, expect: { kind: 'present', version: contentHash(patched.outcomes[0]!.after!) } }],
    })
    expect(second.ok).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

it('SystemSkillWriter applies an explicit snapshot plan without session observation', async () => {
  const { root, lib } = await setup()
  try {
    expect((await lib.create('system-skill', body('system-skill', 'seed'), 'foreground')).ok).toBe(true)
    const writer = new SystemSkillWriter(lib)
    const applied = await writer.apply({
      origin: 'background_review',
      ops: [{ kind: 'write', target: skillBodyTarget('system-skill'), content: body('system-skill', 'system'), expect: { kind: 'present', version: contentHash(body('system-skill', 'seed')) } }],
    })
    expect(applied.ok).toBe(true)
    expect(await lib.read('system-skill')).toContain('system')
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
