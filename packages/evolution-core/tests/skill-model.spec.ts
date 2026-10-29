// @tier fast
import { describe, expect, it, vi } from 'vitest'
import { contentHash, SkillModel, type SkillModelProvider, type SkillSummary } from '@deepseek-ai/dsh-evolution-core'

const alpha: SkillSummary = {
  name: 'alpha',
  description: 'Alpha skill.',
  path: 'D:/skills/alpha',
  protectedBy: null,
  protectionUnknown: false,
  managed: true,
  whenToUse: 'When alpha is needed.',
  frontmatter: { name: 'alpha', description: 'Alpha skill.', whenToUse: 'When alpha is needed.' },
}

function provider(overrides: Partial<SkillModelProvider> = {}): SkillModelProvider {
  return {
    list: vi.fn(async () => [alpha]),
    read: vi.fn(async () => '# Alpha\n\nBody.'),
    listSupportFiles: vi.fn(async () => []),
    readSupportFile: vi.fn(async () => null),
    ...overrides,
  }
}

describe('SkillModel', () => {
  it('forwards list query', async () => {
    const list = vi.fn(async () => [alpha])
    const model = new SkillModel(provider({ list }))
    expect(await model.list({ withFrontmatter: true })).toEqual([alpha])
    expect(list).toHaveBeenCalledWith({ withFrontmatter: true })
  })

  it('builds one document with deterministic hashes', async () => {
    const model = new SkillModel(provider({ listSupportFiles: async () => ['references/a.md', 'references/b.md'], readSupportFile: async (_name, path) => path.endsWith('a.md') ? 'A' : 'BB' }))
    const doc = await model.get('alpha')
    expect(doc?.readable).toBe(true)
    expect(doc?.content).toBe('# Alpha\n\nBody.')
    expect(doc?.frontmatter).toEqual(alpha.frontmatter)
    expect(doc?.hashes.content).toBe(contentHash('# Alpha\n\nBody.'))
    expect(doc?.support.map(file => file.path)).toEqual(['references/a.md', 'references/b.md'])
    expect(doc?.support.map(file => file.bytes)).toEqual([1, 2])
    expect(doc?.hashes.support).toBe(contentHash(JSON.stringify([
      ['references/a.md', contentHash('A'), 1],
      ['references/b.md', contentHash('BB'), 2],
    ])))
  })

  it('changes the three-field hash when whenToUse changes', async () => {
    const model = new SkillModel(provider())
    const before = await model.get('alpha')
    const changed = { ...alpha, whenToUse: 'When alpha is not needed.' }
    const model2 = new SkillModel(provider({ list: async () => [changed] }))
    const after = await model2.get('alpha')
    expect(before?.hashes.threeField).not.toBe(after?.hashes.threeField)
  })

  it('returns null for a missing skill', async () => {
    const model = new SkillModel(provider({ list: async () => [] }))
    expect(await model.get('missing')).toBeNull()
  })

  it('marks an unreadable skill without inventing content', async () => {
    const model = new SkillModel(provider({ read: async () => { throw new Error('EACCES') } }))
    const doc = await model.get('alpha')
    expect(doc?.readable).toBe(false)
    expect(doc?.content).toBe('')
    expect(doc?.support).toEqual([])
  })
})
