// @tier pre-tag
/**
 * G5 (in-use protection): the reverse map the consolidation pool excludes on. It is pure, so it is
 * pinned directly rather than through a full curator run: the value is a Set of SOURCES (a refusal
 * has to be able to name the referrers), and a skill nobody names is absent from the map.
 */
import { expect, it } from 'vitest'
import { referencedSkillNames } from '@deepseek-ai/dsh-evolution-curator'

const withRelated = (name: string, related: readonly string[] = []): string => [
  '---',
  'name: ' + name,
  'description: ' + name + ' body',
  ...related.length === 0 ? [] : ['related_skills: [' + related.join(', ') + ']'],
  '---',
  '',
  'Body of ' + name,
].join(String.fromCharCode(10))

it('未被引用的技能不出现在反向集里', () => {
  const map = referencedSkillNames(new Map([['lonely', withRelated('lonely')]]))
  expect(map.size).toBe(0)
})

it('被引用的技能进反向集，且值能点名引用者', () => {
  const map = referencedSkillNames(new Map([
    ['writer', withRelated('writer', ['source-a'])],
    ['source-a', withRelated('source-a')],
  ]))
  expect([...map.keys()]).toEqual(['source-a'])
  expect([...map.get('source-a') ?? []]).toEqual(['writer'])
})

it('互相引用 ⇒ 两个键互指（两者都会被候选池排除）', () => {
  const map = referencedSkillNames(new Map([
    ['a', withRelated('a', ['b'])],
    ['b', withRelated('b', ['a'])],
  ]))
  expect([...map.keys()].sort()).toEqual(['a', 'b'])
  expect([...map.get('a') ?? []]).toEqual(['b'])
  expect([...map.get('b') ?? []]).toEqual(['a'])
})
