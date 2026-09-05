import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentHash, SkillLibrary, loadMutations, loadSuppressedNames, mutationsFile, nodeEvolutionIo, recordMutation } from '@deepseek-ai/dsh-evolution-core'

const USABLE = (name: string) => `---
name: ${name}
description: A usable skill for mutation tests.
---

# ${name}

Body of ${name}.
`

it('recordMutation appends and trims to the cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-mutations-'))
  const io = nodeEvolutionIo()
  for (let index = 0; index < 5; index += 1) {
    await recordMutation(root, io, { skillName: `s${index}`, action: 'update', summary: 'x', at: new Date().toISOString() }, 3)
  }
  const records = await loadMutations(root, io)
  expect(records.length).toBe(3)
  expect(records.map(record => record.skillName)).toEqual(['s2', 's3', 's4'])
  await rm(root, { recursive: true, force: true })
})

it('legacy plain-array sidecars stay readable (B2 read compat)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-sidecar-compat-'))
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
  await rm(root, { recursive: true, force: true })
})

it('SkillLibrary mutations write audit records with before/after hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-mutations-lib-'))
  const lib = new SkillLibrary(root)
  await lib.create('audited-skill', USABLE('audited-skill'), 'foreground')
  await lib.update('audited-skill', USABLE('audited-skill').replace('Body of audited-skill.', 'Updated body.'))
  const records = await lib.listMutations()
  expect(records.map(record => record.action)).toEqual(['create', 'update'])
  expect(records[1]?.beforeHash).toBeTruthy()
  expect(records[1]?.afterHash).toBeTruthy()
  expect(records[1]?.beforeHash).not.toBe(records[1]?.afterHash)
  await rm(root, { recursive: true, force: true })
})

it('F-337: audit afterHash matches the bytes actually on disk (update and patch)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-mutations-hash-'))
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
  await rm(root, { recursive: true, force: true })
})

it('drops mutation records without a string timestamp (P2-3)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-mutations-at-'))
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
  await rm(root, { recursive: true, force: true })
})
