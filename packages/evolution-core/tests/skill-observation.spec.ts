import { describe, expect, it } from 'vitest'
import {
  SkillObservationStore,
  skillBodyTarget,
  skillSupportTarget,
  skillTarget,
  skillVersionOf,
} from '../src/skill-observation.ts'

describe('skill observation targets', () => {
  it('normalizes the skill body to the empty relative path', () => {
    expect(skillBodyTarget('  my-skill  ')).toEqual({
      skill: 'my-skill',
      relPath: '',
      targetKey: 'my-skill::',
    })
  })

  it('normalizes Windows separators and redundant segments for support files', () => {
    expect(skillSupportTarget('my-skill', 'references\\notes//a.md')).toEqual({
      skill: 'my-skill',
      relPath: 'references/notes/a.md',
      targetKey: 'my-skill::references/notes/a.md',
    })
    expect(skillTarget('my-skill', './references/notes/a.md')).toEqual(skillSupportTarget('my-skill', 'references/notes/a.md'))
  })

  it('refuses path escape and absolute support paths', () => {
    expect(() => skillSupportTarget('my-skill', 'references/..\\secret.md')).toThrow('must not contain ".."')
    expect(() => skillSupportTarget('my-skill', '/etc/passwd')).toThrow('must be relative')
    expect(() => skillSupportTarget('my-skill', 'C:\\secret.md')).toThrow('must be relative')
  })

  it('refuses an empty support path instead of aliasing SKILL.md', () => {
    expect(() => skillSupportTarget('my-skill', '')).toThrow('non-empty support path')
    expect(() => skillSupportTarget('my-skill', '/')).toThrow('must be relative')
  })
})

describe('skill observations', () => {
  it('keeps observations isolated per owner', () => {
    const store = new SkillObservationStore()
    const ownerA = {}
    const ownerB = {}
    const target = skillBodyTarget('my-skill')
    const version = skillVersionOf('body')

    store.record(ownerA, target, { kind: 'present', version })

    expect(store.requirePresent(ownerA, target)).toEqual({ version })
    expect(store.requirePresent(ownerB, target)).toEqual({ kind: 'unobserved' })
  })

  it('represents absent as a first-class observation', () => {
    const store = new SkillObservationStore()
    const owner = {}
    const target = skillSupportTarget('my-skill', 'references/new.md')

    store.record(owner, target, { kind: 'absent' })

    expect(store.get(owner, target)).toEqual({ kind: 'absent' })
    expect(store.requirePresent(owner, target)).toEqual({ kind: 'absent' })
  })

  it('hashes content identity across line-ending differences', () => {
    expect(skillVersionOf('a\nb')).toBe(skillVersionOf('a\r\nb'))
    expect(skillVersionOf('a\nb')).not.toBe(skillVersionOf('a\nc'))
  })

  it('treats a re-read as the newest observation', () => {
    const store = new SkillObservationStore()
    const owner = {}
    const target = skillBodyTarget('my-skill')
    const first = skillVersionOf('first')
    const second = skillVersionOf('second')

    store.record(owner, target, { kind: 'present', version: first })
    store.record(owner, target, { kind: 'present', version: second })

    expect(store.requirePresent(owner, target)).toEqual({ version: second })
  })

  it('drops all observations on clear', () => {
    const store = new SkillObservationStore()
    const owner = {}
    const target = skillBodyTarget('my-skill')

    store.record(owner, target, { kind: 'present', version: skillVersionOf('body') })
    store.clear()

    expect(store.requirePresent(owner, target)).toEqual({ kind: 'unobserved' })
  })
})
