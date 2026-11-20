import { describe, expect, it } from 'vitest'
import {
  decideLiteralEdit,
  decideSkillWrite,
  skillContentVersion,
  type SkillWriteCurrent,
} from '../src/skill-write-intent.ts'

const present = (content: string): SkillWriteCurrent => ({
  kind: 'present',
  version: skillContentVersion(content),
  content,
})

describe('createIfAbsent', () => {
  it('writes only when absent', () => {
    expect(decideSkillWrite({ kind: 'createIfAbsent', next: 'body' }, { kind: 'absent' })).toEqual({
      kind: 'write',
      next: 'body',
      replacements: 0,
    })
    expect(decideSkillWrite({ kind: 'createIfAbsent', next: 'body' }, present('old'))).toMatchObject({
      kind: 'refuse',
      reason: 'already-exists',
    })
  })
})

describe('replaceIfVersion', () => {
  it('requires a present target at the expected version', () => {
    const current = present('old')
    expect(decideSkillWrite({ kind: 'replaceIfVersion', expected: current.version, next: 'new' }, current)).toEqual({
      kind: 'write',
      next: 'new',
      replacements: 0,
    })
    expect(decideSkillWrite({ kind: 'replaceIfVersion', expected: 'other', next: 'new' }, current)).toMatchObject({
      kind: 'refuse',
      reason: 'stale',
    })
    expect(decideSkillWrite({ kind: 'replaceIfVersion', expected: 'other', next: 'new' }, { kind: 'absent' })).toMatchObject({
      kind: 'refuse',
      reason: 'not-found',
    })
  })
})

describe('editIfVersion', () => {
  it('checks the version before matching, so a disjoint-region edit is still stale', () => {
    const current = present('line one\nline two\n')
    const stale = decideSkillWrite({
      kind: 'editIfVersion',
      expected: 'old-version',
      oldString: 'line two',
      newString: 'line 2',
    }, current)
    expect(stale).toMatchObject({ kind: 'refuse', reason: 'stale' })
  })

  it('replaces one occurrence when old_string is unique', () => {
    const current = present('a\nb\nc')
    expect(decideSkillWrite({
      kind: 'editIfVersion',
      expected: current.version,
      oldString: 'b',
      newString: 'B',
    }, current)).toEqual({ kind: 'write', next: 'a\nB\nc', replacements: 1 })
  })

  it('refuses multiple occurrences unless replace_all is explicit', () => {
    const current = present('x x x')
    expect(decideSkillWrite({
      kind: 'editIfVersion',
      expected: current.version,
      oldString: 'x',
      newString: 'y',
    }, current)).toMatchObject({ kind: 'refuse', reason: 'ambiguous' })

    expect(decideSkillWrite({
      kind: 'editIfVersion',
      expected: current.version,
      oldString: 'x',
      newString: 'y',
      replaceAll: true,
    }, current)).toEqual({ kind: 'write', next: 'y y y', replacements: 3 })
  })

  it('refuses a missing literal, no-op, and empty literal', () => {
    const current = present('abc')
    expect(decideSkillWrite({
      kind: 'editIfVersion',
      expected: current.version,
      oldString: 'z',
      newString: 'y',
    }, current)).toMatchObject({ kind: 'refuse', reason: 'not-found-match' })
    expect(decideSkillWrite({
      kind: 'editIfVersion',
      expected: current.version,
      oldString: 'a',
      newString: 'a',
    }, current)).toMatchObject({ kind: 'refuse', reason: 'invalid' })
    expect(decideLiteralEdit('abc', '', 'x', false)).toMatchObject({ kind: 'refuse', reason: 'invalid' })
  })
})

describe('content versions', () => {
  it('normalizes line endings and detects content changes', () => {
    expect(skillContentVersion('a\nb')).toBe(skillContentVersion('a\r\nb'))
    expect(skillContentVersion('a\nb')).not.toBe(skillContentVersion('a\nc'))
  })
})
