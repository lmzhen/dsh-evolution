import { expect, it } from 'vitest'
import { SkillLibrary, transactIo } from '@deepseek-ai/dsh-evolution-core'
import { fakeIo } from '../../test-support/fake-io.ts'

/**
 * F-208: SkillLibrary mutators are transaction-aware. Two layers are shipped:
 * the process-level `serial` queue (so two concurrent mutators on one skill
 * never interleave their read-modify-write) and an injectable `transact`
 * (so a single-file write's read+validate+write runs under the cross-process
 * lock when a caller wires one in).
 */
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

it('V4-20: binds the IO backend transact by default when none is injected', async () => {
  const io = fakeIo()
  const calls: string[] = []
  // The backend ships a transact (as nodeEvolutionIo does) but the caller does
  // not inject one — the library must bind it via the IO seam by default.
  io.transact = async (path, task) => {
    calls.push(path)
    const current = await io.readText(path)
    const next = await task(current)
    if (next === null) await io.remove(path)
    else await io.writeText(path, next)
  }
  const lib = new SkillLibrary('/skills', io)
  const created = await lib.create('tx-default-skill', SKILL_TX('tx-default-skill', 'body line.\n\nbody line 2.'), 'foreground')
  expect(created.ok).toBe(true)
  calls.length = 0
  await lib.update('tx-default-skill', SKILL_TX('tx-default-skill', 'body line (updated).\n\nbody line 2.'))
  // The single-file write went through the backend transact (not the plain path).
  expect(calls.map(p => p.replaceAll('\\', '/')).some(p => p.includes('SKILL.md'))).toBe(true)
  expect(await io.readText('/skills/tx-default-skill/SKILL.md')).toContain('body line (updated).')
})

it('V4-20: a backend without transact keeps the plain read→write path', async () => {
  const io = fakeIo() // no `transact` method at all
  const lib = new SkillLibrary('/skills', io)
  const created = await lib.create('tx-no-transact', SKILL_TX('tx-no-transact', 'alpha.\n\nbeta.'), 'foreground')
  expect(created.ok).toBe(true)
  expect(await io.readText('/skills/tx-no-transact/SKILL.md')).toContain('alpha.')
})

it('V26-01: a concurrent write landing inside the commit transact aborts the merge (CAS drift, rollback intact)', async () => {
  // Deterministic drift harness: the competing writer patches INSIDE the
  // injected transact, BEFORE the task reads `current` — so the disk no
  // longer matches the plan-time baseline when the CAS compares. This locks
  // the drift-detect → abort → rollback mechanism end-to-end (v22 LOCK-1 +
  // v24 V24-01): with the CAS removed (blind writeText of the plan-time
  // merge) the merge would report ok:true and the concurrent patch would be
  // silently lost.
  const io = fakeIo()
  const lib = new SkillLibrary('/skills', io)
  await lib.create('cas-target', SKILL_TX('cas-target', 'original body.'), 'foreground')
  await lib.create('cas-source', SKILL_TX('cas-source', 'source body.'), 'foreground')
  const targetPath = '/skills/cas-target/SKILL.md'
  let driftInjected = false
  const fakeTransact: typeof transactIo = async (ioLike, path, task) => {
    if (!driftInjected && path.replaceAll('\\', '/') === targetPath) {
      driftInjected = true
      // The competing instance has its own serial chain — exactly like
      // tool-skill-manage vs curator in one process.
      const other = new SkillLibrary('/skills', io)
      const patch = await other.patch('cas-target', 'original body.', 'CONCURRENT EDIT.')
      if (!patch.ok) throw new Error(`concurrent patch failed: ${patch.message}`)
    }
    const current = await ioLike.readText(path)
    const next = await task(current)
    if (next === null) await ioLike.remove(path)
    else await ioLike.writeText(path, next)
  }
  const lib2 = new SkillLibrary('/skills', io, undefined, undefined, fakeTransact)
  const result = await lib2.consolidate('cas-target', ['cas-source'], 'foreground')
  expect(result.ok).toBe(false)
  expect(result.message).toContain('concurrent modification detected')
  // The concurrent writer's bytes survived the aborted merge; the plan-time
  // merge content never landed.
  expect(await io.readText(targetPath)).toContain('CONCURRENT EDIT.')
  expect(await io.readText(targetPath)).not.toContain('source body.')
})
