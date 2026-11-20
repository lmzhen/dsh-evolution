// @tier fast
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SkillObservationStore, skillVersionOf } from '../src/skill-observation.ts'
import {
  recordFsSkillObservation,
  skillTargetFromHostPath,
} from '../src/skill-observation-source.ts'

const root = resolve('D:/lab/skills')

describe('skill target from host path', () => {
  it('maps SKILL.md to the body target', () => {
    expect(skillTargetFromHostPath(root, resolve(root, 'my-skill/SKILL.md'))).toMatchObject({
      skill: 'my-skill',
      relPath: '',
      targetKey: 'my-skill::',
    })
  })

  it('maps a support file to its relative path', () => {
    expect(skillTargetFromHostPath(root, resolve(root, 'my-skill/references/notes/a.md'))).toMatchObject({
      skill: 'my-skill',
      relPath: 'references/notes/a.md',
      targetKey: 'my-skill::references/notes/a.md',
    })
  })

  it('rejects paths outside the skills root', () => {
    expect(skillTargetFromHostPath(root, resolve(root, '../outside/SKILL.md'))).toBeUndefined()
    expect(skillTargetFromHostPath(root, resolve(root, 'my-skill/../other/SKILL.md'))).toMatchObject({ skill: 'other' })
  })

  it('rejects the root itself and loose root files', () => {
    expect(skillTargetFromHostPath(root, root)).toBeUndefined()
    expect(skillTargetFromHostPath(root, resolve(root, 'README.md'))).toBeUndefined()
  })

  it('rejects relative and malformed inputs', () => {
    expect(skillTargetFromHostPath(root, 'my-skill/SKILL.md')).toBeUndefined()
    expect(skillTargetFromHostPath('relative-root', resolve(root, 'my-skill/SKILL.md'))).toBeUndefined()
  })
})

describe('record platform skill observations', () => {
  it('records only paths that map to a skill file', () => {
    const store = new SkillObservationStore()
    const owner = {}
    const target = recordFsSkillObservation(store, owner, root, {
      hostPath: resolve(root, 'my-skill/SKILL.md'),
      version: 'v1',
    })

    expect(target?.targetKey).toBe('my-skill::')
    expect(store.requirePresent(owner, target!)).toEqual({ version: 'v1' })

    expect(recordFsSkillObservation(store, owner, root, {
      hostPath: resolve(root, 'README.md'),
      version: 'v2',
    })).toBeUndefined()
    expect(store.get(owner, { skill: 'README.md', relPath: '', targetKey: 'README.md::' })).toBeUndefined()
  })

  it('keeps the platform version opaque while content versions stay content-based', () => {
    const store = new SkillObservationStore()
    const owner = {}
    const target = recordFsSkillObservation(store, owner, root, {
      hostPath: resolve(root, 'my-skill/references/a.md'),
      version: 'mtime-and-size',
    })

    // The source does not reinterpret the platform token; content hashing is a
    // separate semantic anchor used by staged writes.
    expect(store.requirePresent(owner, target!)).toEqual({ version: 'mtime-and-size' })
    expect(skillVersionOf('body')).toMatch(/^[0-9a-f]{64}$/)
  })
})
