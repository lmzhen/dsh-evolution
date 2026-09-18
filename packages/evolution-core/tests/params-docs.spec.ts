import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PARAM_ALIASES } from '@deepseek-ai/dsh-evolution-core'

/**
 * G0/S0.3 guard: every deprecated parameter alias must be documented where its
 * owning package is read — README and Config JSDoc both name the alias AND its
 * canonical id, and both carry the `G0/S0.3` marker so a later edit cannot drop
 * the deprecation notice silently. The machine-readable source stays
 * PARAM_ALIASES (evolution-core); this spec only pins the human-facing half.
 */
const OWNER: Record<string, string> = {
  reviewMemoryInterval: 'evolution-review',
  reviewSkillInterval: 'evolution-review',
  curatorIntervalHours: 'evolution-curator',
  skillContentChars: 'tool-skill-manage',
  memoryChars: 'memory-files',
  userChars: 'memory-files',
}

const MARKER = /G0\/S0\.3/

/** Owner package of a canonical id, or a loud failure when the map is stale. */
function ownerOf(canonical: string): string {
  const owner = OWNER[canonical]
  if (owner === undefined) throw new Error('no owning package declared for ' + canonical)
  return owner
}

describe('deprecated parameter aliases are documented (G0/S0.3)', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))

  it('covers every alias with an owning package that has both doc surfaces', () => {
    for (const canonical of Object.values(PARAM_ALIASES)) {
      const owner = ownerOf(canonical)
      const readme = join(root, owner, 'README.md')
      const source = join(root, owner, 'src', 'index.ts')
      expect(() => readFileSync(readme, 'utf8'), readme).not.toThrow()
      expect(() => readFileSync(source, 'utf8'), source).not.toThrow()
    }
  })

  it('names the alias, the canonical id and the marker in README and Config JSDoc', () => {
    for (const [alias, canonical] of Object.entries(PARAM_ALIASES)) {
      const owner = ownerOf(canonical)
      const readme = readFileSync(join(root, owner, 'README.md'), 'utf8')
      const source = readFileSync(join(root, owner, 'src', 'index.ts'), 'utf8')
      for (const [label, text] of [['README', readme], ['src/index.ts', source]] as const) {
        expect(text, owner + ' ' + label + ' names ' + alias).toContain(alias)
        expect(text, owner + ' ' + label + ' names ' + canonical).toContain(canonical)
        expect(text, owner + ' ' + label + ' carries the G0/S0.3 marker').toMatch(MARKER)
      }
    }
  })
})
