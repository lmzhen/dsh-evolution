import { describe, expect, it } from 'vitest'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

/**
 * P0-5 regression suite for the 3-level fuzzy patch match chain:
 *  - empty / whitespace-only oldString must be refused, never spliced;
 *  - a self-containing newString must terminate (former recursive
 *    fuzzyReplace overflowed the stack);
 *  - property fuzz: patched output keeps every non-matched byte, and the
 *    only different span is the replacement itself.
 */

function fakeIo(): EvolutionIoLike & { files: Map<string, string> } {
  const files = new Map<string, string>()
  const normalize = (path: string) => path.replaceAll('\\', '/')
  const children = (path: string) => {
    const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
    const names = new Set<string>()
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const name = rest.split('/')[0]
      if (name) names.add(name)
    }
    return [...names]
  }
  const removePrefix = (path: string) => {
    const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
    for (const key of [...files.keys()]) {
      if (key === normalize(path) || key.startsWith(prefix)) files.delete(key)
    }
  }
  return {
    files,
    async readText(path) { return files.get(normalize(path)) ?? null },
    async writeText(path, content) { files.set(normalize(path), content) },
    async remove(path) { removePrefix(path) },
    async list(path) { return children(path) },
    async exists(path) {
      const key = normalize(path)
      if (files.has(key)) return true
      const prefix = key.replace(/\/$/, '') + '/'
      return [...files.keys()].some(file => file.startsWith(prefix))
    },
    async rename(_path, _destination) { throw new Error('rename unsupported') },
    async copy(path, destination) {
      const prefix = normalize(path).replace(/[\\/]+$/, '') + '/'
      const destPrefix = normalize(destination).replace(/\/$/, '') + '/'
      for (const [key, value] of files) {
        if (key === normalize(path) || key.startsWith(prefix)) {
          const suffix = key === normalize(path) ? key.slice(key.lastIndexOf('/') + 1) : key.slice(prefix.length)
          files.set(destPrefix + suffix, value)
        }
      }
    },
  }
}

async function setupSkill(lib: SkillLibrary, content: string): Promise<string> {
  const created = await lib.create('fuzz-skill', '---\nname: fuzz-skill\ndescription: Fuzz target.\n---\n\n# Fuzz\n', 'background_review')
  expect(created.ok).toBe(true)
  const wrote = await lib.writeSupportFile('fuzz-skill', 'references/target.md', content, 'background_review')
  if (!wrote.ok) console.error('WROTE-FAIL:', wrote.message)
  expect(wrote.ok).toBe(true)
  return 'references/target.md'
}

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CHARS = ['a', 'b', 'c', ' ', '  ', '\n', '\t', 'x']

function randomString(rnd: () => number, maxLen: number): string {
  const len = Math.floor(rnd() * (maxLen + 1))
  let out = ''
  for (let i = 0; i < len; i += 1) out += (CHARS[Math.floor(rnd() * CHARS.length)] ?? '').charAt(0)
  return out
}

describe('fuzzy patch P0-5 guards', () => {
  it('refuses an empty oldString without touching the file', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const file = await setupSkill(lib, 'keep this\n')
    const result = await lib.patch('fuzz-skill', '', 'X', file, false, 'background_review')
    expect(result.ok).toBe(false)
    expect(await io.readText(`/skills/fuzz-skill/${file}`)).toBe('keep this\n')
  })

  it('refuses a whitespace-only oldString', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const file = await setupSkill(lib, 'keep this\n')
    const result = await lib.patch('fuzz-skill', '   ', 'X', file, false, 'background_review')
    expect(result.ok).toBe(false)
    expect(await io.readText(`/skills/fuzz-skill/${file}`)).toBe('keep this\n')
  })

  it('terminates when newString contains oldString (former stack overflow)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const file = await setupSkill(lib, 'alpha beta gamma\n')
    const result = await lib.patch('fuzz-skill', 'beta', 'beta-beta', file, true, 'background_review')
    expect(result.ok).toBe(true)
    const readBack = await io.readText(`/skills/fuzz-skill/${file}`)
    expect(readBack).toBe('alpha beta-beta gamma\n')
  })

  it('exact-match replacement is literal — no $&/$`/$’/$$ expansion (E-2, 0.3.16)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    // String.replace would expand `$'` (text after the match) and `$$` (a
    // literal $) — the file content would silently change shape.
    const file = await setupSkill(lib, 'a foo b\n')
    const result = await lib.patch('fuzz-skill', 'foo', "100$'", file, false, 'background_review')
    expect(result.ok).toBe(true)
    expect(await io.readText(`/skills/fuzz-skill/${file}`)).toBe('a 100$\' b\n')
    const wroteDollar = await lib.writeSupportFile('fuzz-skill', 'references/dollar.md', 'a foo b\n', 'background_review')
    expect(wroteDollar.ok).toBe(true)
    const dollar = await lib.patch('fuzz-skill', 'foo', '$$bar', 'references/dollar.md', false, 'background_review')
    expect(dollar.ok).toBe(true)
    expect(await io.readText('/skills/fuzz-skill/references/dollar.md')).toBe('a $$bar b\n')
  })

  it('fuzzy-drift path is equally literal on $ patterns (E-2, 0.3.16)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const file = await setupSkill(lib, 'a  foo  b\n') // double spaces → fuzzy stage
    const result = await lib.patch('fuzz-skill', 'foo', "100$'", file, false, 'background_review')
    expect(result.ok).toBe(true)
    expect(await io.readText(`/skills/fuzz-skill/${file}`)).toBe('a  100$\'  b\n')
  })

  it('replaceAll stays literal on $ patterns (E-2, 0.3.16)', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const file = await setupSkill(lib, 'x foo y foo\n')
    const result = await lib.patch('fuzz-skill', 'foo', '1$&2', file, true, 'background_review')
    expect(result.ok).toBe(true)
    expect(await io.readText(`/skills/fuzz-skill/${file}`)).toBe('x 1$&2 y 1$&2\n')
  })

  it('replaceAll rewrites every exact match', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const file = await setupSkill(lib, 'x foo y foo z\n')
    const result = await lib.patch('fuzz-skill', 'foo', 'bar', file, true, 'background_review')
    expect(result.ok).toBe(true)
    expect(await io.readText(`/skills/fuzz-skill/${file}`)).toBe('x bar y bar z\n')
  })

  it('fuzzy whitespace run matches and preserves surrounding bytes', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const file = await setupSkill(lib, 'line1\nkeep   spacing\nline3\n')
    const result = await lib.patch('fuzz-skill', 'keep spacing', 'tight', file, false, 'background_review')
    expect(result.ok).toBe(true)
    expect(await io.readText(`/skills/fuzz-skill/${file}`)).toBe('line1\ntight\nline3\n')
  })

  it('boundary-trim stage keeps an indented citation patchable', async () => {
    const io = fakeIo()
    const lib = new SkillLibrary('/skills', io)
    const file = await setupSkill(lib, 'header\n  foo bar\nfooter\n')
    const result = await lib.patch('fuzz-skill', '  foo bar\n', '  baz qux\n', file, false, 'background_review')
    expect(result.ok).toBe(true)
    expect(await io.readText(`/skills/fuzz-skill/${file}`)).toBe('header\n  baz qux\nfooter\n')
  })

  it('random fuzz never throws and patches only the matched span', async () => {
    const rnd = mulberry32(0xC0FFEE)
    for (let round = 0; round < 500; round += 1) {
      const io = fakeIo()
      const lib = new SkillLibrary('/skills', io)
      // Whitespace-free oldString guarantees the exact stage-0 path, so the
      // expected result is computable with plain replace/split semantics.
      let oldString = randomAlpha(rnd, 4)
      while (oldString === '') oldString = randomAlpha(rnd, 4)
      const newString = randomString(rnd, 6)
      const pre = randomString(rnd, 6)
      const post = randomString(rnd, 6)
      const content = pre + oldString + post
      const file = await setupSkill(lib, content)
      const replaceAll = rnd() < 0.5
      const result = await lib.patch('fuzz-skill', oldString, newString, file, replaceAll, 'background_review')
      // No throw; result shape is stable.
      expect(typeof result.ok).toBe('boolean')
      // OldString was spliced in verbatim, so the exact stage-0 path always hits.
      if (!result.ok) console.error('PATCH-FAIL:', result.message, '| old=', JSON.stringify(oldString), '| content=', JSON.stringify(content), '| new=', JSON.stringify(newString))
      expect(result.ok).toBe(true)
      const readBack = await io.readText(`/skills/fuzz-skill/${file}`)
      const expected = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
      expect(readBack).toBe(expected.trimEnd() + '\n')
    }
  })

  it('candidate-fuzz exercises no-match and self-containing mixes without draining', async () => {
    const rnd = mulberry32(0xBADF00D)
    for (let round = 0; round < 500; round += 1) {
      const io = fakeIo()
      const lib = new SkillLibrary('/skills', io)
      const oldString = randomString(rnd, 5)
      const newString = randomString(rnd, 8)
      const content = randomString(rnd, 12)
      const file = await setupSkill(lib, content)
      const replaceAll = rnd() < 0.5
      // Must settle (self-containing newString used to overflow the stack)
      // and never throw.
      const result = await lib.patch('fuzz-skill', oldString, newString, file, replaceAll, 'background_review')
      expect(typeof result.ok).toBe('boolean')
    }
  })
})

function randomAlpha(rnd: () => number, maxLen: number): string {
  const len = Math.floor(rnd() * (maxLen + 1))
  let out = ''
  for (let i = 0; i < len; i += 1) out += 'abc'.charAt(Math.floor(rnd() * 3))
  return out
}
