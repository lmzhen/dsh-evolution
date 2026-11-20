import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core/skills'
import { tempRoot } from '../../test-support/temp-home.ts'

const skillBody = (body: string, name = 'cas-skill') => `---\nname: ${name}\ndescription: A sufficiently long description for the CAS test skill.\n---\n\n${body}`

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })))
})

async function makeLibrary(): Promise<SkillLibrary> {
  const root = await tempRoot('dsh-evo-skill-cas-')
  roots.push(root)
  return new SkillLibrary(root)
}

describe('SkillLibrary CAS primitive', () => {
  it('lets exactly one concurrent replace with the same expected version win', async () => {
    const lib = await makeLibrary()
    await lib.create('cas-skill', skillBody('a\nb\nc\n'), 'foreground')
    const before = await lib.read('cas-skill')
    expect(before).not.toBeNull()
    const expected = contentHash(before!)

    const [first, second] = await Promise.all([
      lib.writeFileCas('cas-skill', '', { kind: 'replaceIfVersion', expected, next: 'first\n' }),
      lib.writeFileCas('cas-skill', '', { kind: 'replaceIfVersion', expected, next: 'second\n' }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect([first, second].filter(result => !result.ok)).toEqual([
      expect.objectContaining({ reason: 'stale' }),
    ])
    expect(['first\n', 'second\n']).toContain(await lib.read('cas-skill'))
  }, 30_000)

  it('lets exactly one concurrent createIfAbsent win', async () => {
    const lib = await makeLibrary()
    const [first, second] = await Promise.all([
      lib.writeFileCas('new-skill', '', { kind: 'createIfAbsent', next: 'one\n' }),
      lib.writeFileCas('new-skill', '', { kind: 'createIfAbsent', next: 'two\n' }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect([first, second].filter(result => !result.ok)).toEqual([
      expect.objectContaining({ reason: 'already-exists' }),
    ])
  }, 30_000)

  it('checks the expected version before matching a disjoint edit', async () => {
    const lib = await makeLibrary()
    await lib.create('edit-skill', skillBody('line one\nline two\n', 'edit-skill'), 'foreground')
    const version = contentHash((await lib.read('edit-skill'))!)

    const edited = await lib.writeFileCas('edit-skill', '', {
      kind: 'editIfVersion',
      expected: version,
      oldString: 'line one',
      newString: 'LINE ONE',
    })
    expect(edited.ok).toBe(true)

    const stale = await lib.writeFileCas('edit-skill', '', {
      kind: 'editIfVersion',
      expected: version,
      oldString: 'line two',
      newString: 'LINE TWO',
    })
    expect(stale).toEqual(expect.objectContaining({ ok: false, reason: 'stale' }))
    expect(await lib.read('edit-skill')).toContain('line two')
  }, 30_000)

  it('rejects a non-unique literal edit through the store primitive', async () => {
    const lib = await makeLibrary()
    await lib.create('ambiguous-skill', skillBody('x\nx\n', 'ambiguous-skill'), 'foreground')
    const version = contentHash((await lib.read('ambiguous-skill'))!)
    const result = await lib.writeFileCas('ambiguous-skill', '', {
      kind: 'editIfVersion',
      expected: version,
      oldString: 'x',
      newString: 'y',
    })
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'ambiguous' }))
  }, 30_000)
})
