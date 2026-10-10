// @vitest-environment node
/**
 * A7 (S5.5): the audit's `before` must be the bytes the operation actually replaced.
 *
 * `remove_file` read the target ONCE for the fast-path verdict and then again inside the delete's
 * transact task. A concurrent writer landing between the two reads made the ledger name bytes this
 * operation never removed (the delete itself still committed — an unanchored caller accepts any
 * locked read), so the record and the history chain pointed at a state that was not the one replaced.
 */
import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillLibrary, contentHash, nodeEvolutionIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

const SKILL_MD = `---
name: demo-skill
description: A demo skill for the audit-baseline fixture.
---

# Demo

## Usage

Call it.
`

it('A7: a remove_file audit names the bytes the LOCKED read saw, not the caller-era pre-read', async () => {
  const root = await tempRoot('dsh-evo-a7-remove-')
  const dir = join(root, 'demo-skill')
  await mkdir(join(dir, 'references'), { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), SKILL_MD, 'utf8')
  const target = join(dir, 'references', 'ref.md')
  await writeFile(target, 'pre-read body\n', 'utf8')

  const io = nodeEvolutionIo()
  let landed = false
  // The concurrent write lands the instant AFTER the pre-read returned: the two reads then see
  // different bytes, which is the window the audit record used to describe with the wrong one.
  const gated: EvolutionIoLike = {
    ...io,
    readText: async (path: string) => {
      const text = await io.readText(path)
      if (!landed && path === target) {
        landed = true
        await io.writeText(target, 'concurrent body\n')
      }
      return text
    },
  }
  const lib = new SkillLibrary(root, gated)
  const result = await lib.removeSupportFile('demo-skill', 'references/ref.md')
  expect(result.ok).toBe(true)
  expect(landed).toBe(true)
  const record = (await lib.listMutations()).find(entry => entry.action === 'remove_file')
  expect(record?.beforeHash).toBe(contentHash('concurrent body\n'))
  expect(record?.beforeHash).not.toBe(contentHash('pre-read body\n'))
})
