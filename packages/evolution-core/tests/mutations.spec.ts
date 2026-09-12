import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { contentHash, SkillLibrary, loadMutations, loadSuppressedNames, mutationsFile, nodeEvolutionIo, recordMutation } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

const USABLE = (name: string) => `---
name: ${name}
description: A usable skill for mutation tests.
---

# ${name}

Body of ${name}.
`

it('recordMutation appends and trims to the cap', async () => {
  const root = await tempRoot('dsh-evo-mutations-')
  const io = nodeEvolutionIo()
  for (let index = 0; index < 5; index += 1) {
    await recordMutation(root, io, { skillName: `s${index}`, action: 'update', summary: 'x', at: new Date().toISOString() }, 3)
  }
  const records = await loadMutations(root, io)
  expect(records.length).toBe(3)
  expect(records.map(record => record.skillName)).toEqual(['s2', 's3', 's4'])
})

it('legacy plain-array sidecars stay readable (B2 read compat)', async () => {
  const root = await tempRoot('dsh-evo-sidecar-compat-')
  const io = nodeEvolutionIo()
  await writeFile(join(root, '.mutations.json'), JSON.stringify([
    { skillName: 'old-skill', action: 'update', summary: 'legacy', at: '2026-08-01T00:00:00.000Z' },
  ]), 'utf8')
  await writeFile(join(root, '.curator-suppressed.json'), JSON.stringify(['builtin-a', 'builtin-b']), 'utf8')
  const records = await loadMutations(root, io)
  expect(records).toHaveLength(1)
  expect(records[0]?.skillName).toBe('old-skill')
  const suppressed = await loadSuppressedNames(root, io)
  expect([...suppressed]).toEqual(['builtin-a', 'builtin-b'])
})

it('SkillLibrary mutations write audit records with before/after hashes', async () => {
  const root = await tempRoot('dsh-evo-mutations-lib-')
  const lib = new SkillLibrary(root)
  await lib.create('audited-skill', USABLE('audited-skill'), 'foreground')
  await lib.update('audited-skill', USABLE('audited-skill').replace('Body of audited-skill.', 'Updated body.'))
  const records = await lib.listMutations()
  expect(records.map(record => record.action)).toEqual(['create', 'update'])
  expect(records[1]?.beforeHash).toBeTruthy()
  expect(records[1]?.afterHash).toBeTruthy()
  expect(records[1]?.beforeHash).not.toBe(records[1]?.afterHash)
})

it('F-337: audit afterHash matches the bytes actually on disk (update and patch)', async () => {
  const root = await tempRoot('dsh-evo-mutations-hash-')
  const lib = new SkillLibrary(root)
  const io = nodeEvolutionIo()
  await lib.create('audited-skill', USABLE('audited-skill'), 'foreground')
  await lib.update('audited-skill', USABLE('audited-skill').replace('Body of audited-skill.', 'Updated body.'))
  const updateRecord = (await lib.listMutations()).at(-1)!
  expect(updateRecord?.action).toBe('update')
  expect(updateRecord?.afterHash).toBe(contentHash((await io.readText(join(root, 'audited-skill', 'SKILL.md'))) ?? ''))
  await lib.patch('audited-skill', 'Updated body.', 'Patched body.')
  const patchRecord = (await lib.listMutations()).at(-1)!
  expect(patchRecord?.action).toBe('patch')
  expect(patchRecord?.afterHash).toBe(contentHash((await io.readText(join(root, 'audited-skill', 'SKILL.md'))) ?? ''))
})

it('drops mutation records without a string timestamp (P2-3)', async () => {
  const root = await tempRoot('dsh-evo-mutations-at-')
  await nodeEvolutionIo().writeText(mutationsFile(root), JSON.stringify({
    version: 1,
    records: [
      { skillName: 'broken', action: 'create', at: 5 },
      { skillName: 'kept', action: 'create', at: '2026-01-01T00:00:00.000Z' },
    ],
  }))
  const records = await loadMutations(root, nodeEvolutionIo())
  // `at` feeds .slice() in the command surfaces: a non-string timestamp drops
  // the record instead of throwing later.
  expect(records.map(record => record.skillName)).toEqual(['kept'])
})

it('C-08: a dropped audit record warns once instead of failing silently', async () => {
  const root = await tempRoot('dsh-evo-mut-warn-')
  const io = nodeEvolutionIo()
  await writeFile(join(root, '.mutations.json'), '{corrupt', 'utf8')
  // vi.spyOn misses warns fired inside the io.transact closure under vitest 4
  // (verified by a direct-repro: plain console replacement does intercept).
  const previousWarn = console.warn
  const warnCalls: unknown[][] = []
  console.warn = (...args: unknown[]) => { warnCalls.push(args) }
  try {
    await recordMutation(root, io, { skillName: 's', action: 'update', summary: 'x', at: new Date().toISOString() })
  } finally {
    console.warn = previousWarn
  }
  expect(warnCalls).toHaveLength(1)
  expect(String(warnCalls[0]?.[0])).toContain('malformed')
  // The P3 posture is intact: the malformed file is never overwritten.
  expect(await io.readText(join(root, '.mutations.json'))).toBe('{corrupt')
})
