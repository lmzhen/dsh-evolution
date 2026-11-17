// @tier fast
import { describe, expect, it } from 'vitest'
import { SKILL_ACTIONS, isReadOnlySkillAction, skillActionOf } from '../src/skill-actions.ts'

describe('SKILL_ACTIONS', () => {
  it('registers every tool action exactly once', () => {
    expect(Object.keys(SKILL_ACTIONS).sort()).toEqual([
      'create', 'delete', 'edit', 'extract', 'list', 'patch', 'pin',
      'remove_file', 'restructure', 'review', 'unpin', 'update', 'write_file',
    ])
    expect(skillActionOf('list')?.mutates).toBe(false)
    expect(skillActionOf('review')?.mutates).toBe(false)
    expect(skillActionOf('pin')?.mutates).toBe(false)
    expect(skillActionOf('create')?.mutates).toBe(true)
    expect(skillActionOf('extract')?.needsName).toBe(false)
    expect(isReadOnlySkillAction('list')).toBe(true)
    expect(isReadOnlySkillAction('delete')).toBe(false)
  })

  it('does not treat inherited names as actions', () => {
    expect(skillActionOf('constructor')).toBeUndefined()
    expect(isReadOnlySkillAction('constructor')).toBe(false)
  })
})
