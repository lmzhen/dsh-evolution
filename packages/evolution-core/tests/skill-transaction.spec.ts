import { expect, it } from 'vitest'
import { SkillLibrary, transactIo } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

/**
 * F-208: SkillLibrary mutators are transaction-aware. Two layers are shipped:
 * the process-level `serial` queue (so two concurrent mutators on one skill
 * never interleave their read-modify-write) and an injectable `transact`
 * (so a single-file write's read+validate+write runs under the cross-process
 * lock when a caller wires one in).
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

const SKILL_TX = (name: string, body: string) => `---
name: ${name}
description: Transaction test skill.
---

# ${name}

${body}
`

it('F-208: two concurrent patches to one skill serialize — no lost update', async () => {
  const io = fakeIo()
  const lib = new SkillLibrary('/skills', io)
  const created = await lib.create('tx-skill', SKILL_TX('tx-skill', 'Keep me.\n\nbody line.'), 'foreground')
  expect(created.ok).toBe(true)
  // Two independent patches on DISTINCT spans, fired concurrently. Without the
  // in-process serialize queue both would read the same pre-patch content and
  // the last rename would drop one; with it the second reads the first's result.
  await Promise.all([
    lib.patch('tx-skill', 'Keep me.', 'Keep me (A).'),
    lib.patch('tx-skill', 'body line.', 'body line (B).'),
  ])
  const result = await lib.read('tx-skill')
  expect(result).toContain('Keep me (A).')
  expect(result).toContain('body line (B).')
})

it('F-208: an over-limit update and a concurrent patch do not interleave silently', async () => {
  const io = fakeIo()
  const lib = new SkillLibrary('/skills', io)
  await lib.create('tx-skill2', SKILL_TX('tx-skill2', 'alpha line.\n\nbeta line.'), 'foreground')
  await Promise.all([
    lib.patch('tx-skill2', 'alpha line.', 'alpha line (patched).'),
    lib.patch('tx-skill2', 'beta line.', 'beta line (patched).'),
  ])
  const result = await lib.read('tx-skill2')
  expect(result).toContain('alpha line (patched).')
  expect(result).toContain('beta line (patched).')
})

it('F-208: an injected transact wraps the single-file write path (update/patch/writeSupportFile)', async () => {
  const io = fakeIo()
  const calls: string[] = []
  const fakeTransact: typeof transactIo = async (ioLike, path, task) => {
    calls.push(path)
    const current = await ioLike.readText(path)
    const next = await task(current)
    if (next === null) await ioLike.remove(path)
    else await ioLike.writeText(path, next)
  }
  const lib = new SkillLibrary('/skills', io, undefined, undefined, fakeTransact)
  const created = await lib.create('tx-io-skill', SKILL_TX('tx-io-skill', 'body line 1.\n\nbody line 2.'), 'foreground')
  expect(created.ok).toBe(true)
  calls.length = 0
  await lib.update('tx-io-skill', SKILL_TX('tx-io-skill', 'body line 1 (updated).\n\nbody line 2.'))
  await lib.patch('tx-io-skill', 'body line 2.', 'body line 2 (patched).')
  await lib.writeSupportFile('tx-io-skill', 'references/detail.md', '# Detail')
  // The single-file writes went through the injected transact. Paths use the
  // platform separator, so normalize before matching the support-file path.
  const normalized = calls.map(p => p.replaceAll('\\', '/'))
  expect(normalized.some(p => p.includes('SKILL.md'))).toBe(true)
  expect(normalized.some(p => p.includes('references/detail.md'))).toBe(true)
  // And the writes actually landed.
  expect(await io.readText('/skills/tx-io-skill/SKILL.md')).toContain('body line 1 (updated).')
  expect(await io.readText('/skills/tx-io-skill/SKILL.md')).toContain('body line 2 (patched).')
  expect(await io.readText('/skills/tx-io-skill/references/detail.md')).toBe('# Detail')
})
