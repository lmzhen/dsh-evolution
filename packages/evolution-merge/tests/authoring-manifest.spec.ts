// @tier fast
import { expect, it } from 'vitest'
import { manifestFilesOf, parseAuthoringManifest } from '../src/index.ts'

it('P2-20: parses a fenced JSON envelope instead of treating it as no declaration', () => {
  const parsed = parseAuthoringManifest('Done.\n\n\`\`\`json\n{"target":"umbrella","files":["SKILL.md","references/a.md"]}\n\`\`\`\n')
  expect(parsed).toEqual({ target: 'umbrella', files: ['SKILL.md', 'references/a.md'] })
})

it('P2-20: parses an envelope embedded in prose', () => {
  const parsed = parseAuthoringManifest('I merged it: {"files":["SKILL.md"]} — done.')
  expect(parsed).toEqual({ files: ['SKILL.md'] })
})

it('P2-20: no envelope means only SKILL.md is declared, never every staged file', () => {
  expect(parseAuthoringManifest('I wrote SKILL.md and references/a.md.')).toBeNull()
  expect(manifestFilesOf(null, ['references/a.md'])).toEqual(['SKILL.md'])
})
