import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const BODY = `---
name: demo-skill
description: demonstrate restructure.
---

# Demo

## Details log

- rc.67 detail line

## Usage

Use it.
`

it('P1-1 regression: restructure must NOT duplicate frontmatter (structure-level assertion)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-v7-p1-'))
  const lib = new SkillLibrary(root)
  await lib.create('demo-skill', BODY, 'foreground')
  const result = await lib.restructure('demo-skill', [{ heading: 'Details log', toFile: 'references/log.md' }], 'background_review')
  expect(result.ok).toBe(true)
  const md = await lib.read('demo-skill')
  const parsed = parseFrontmatter(md ?? '')
  expect(parsed).not.toBeNull()
  // The body must be real body — never a second frontmatter block.
  expect(parsed?.body.startsWith('---')).toBe(false)
  // Repeated restructure must not stack frontmatter copies.
  await lib.restructure('demo-skill', [{ heading: 'Usage', toFile: 'references/use.md' }], 'background_review')
  const md2 = await lib.read('demo-skill')
  const parsed2 = parseFrontmatter(md2 ?? '')
  expect(parsed2?.body.startsWith('---')).toBe(false)
  expect(parsed2?.frontmatter.name).toBe('demo-skill')
  // The pointer lines both present, and the content is the ORIGINAL body + pointers.
  expect(md2 ?? '').toContain('> 详见 references/log.md')
  expect(md2 ?? '').toContain('> 详见 references/use.md')
  await rm(root, { recursive: true, force: true })
})
