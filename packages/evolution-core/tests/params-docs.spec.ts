// @tier pre-tag
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PARAM_ALIASES } from '@deepseek-ai/dsh-evolution-core'

/**
 * G0/S0.3 guard: every deprecated parameter alias must be documented where its canonical row is
 * defined — README and Config/source both name the alias AND its canonical id, and both carry the
 * `G0/S0.3` marker so a later edit cannot drop the deprecation notice silently.
 *
 * One table, keyed by the CANONICAL row id (the value PARAM_ALIASES points at). A missing entry is
 * a loud failure: the old two-table split keyed one side by package name and the other by row id, so
 * five of six aliases silently fell back to a package README whose owner never matched a row
 * (audit 09 P0: the test looked green while testing the wrong document).
 */
const DOC_SURFACES: Record<string, { readonly readme: string; readonly source: string }> = {
  reviewMemoryInterval: { readme: 'evolution-review/README.md', source: 'evolution-review/src/index.ts' },
  reviewSkillInterval: { readme: 'evolution-review/README.md', source: 'evolution-review/src/index.ts' },
  curatorIntervalHours: { readme: 'evolution-curator/README.md', source: 'evolution-curator/src/index.ts' },
  skillContentChars: { readme: 'tool-skill-manage/README.md', source: 'tool-skill-manage/src/index.ts' },
  memoryChars: { readme: 'memory/docs/files/README.md', source: 'memory/src/files/index.ts' },
  userChars: { readme: 'memory/docs/files/README.md', source: 'memory/src/files/index.ts' },
}

const MARKER = /G0\/S0\.3/

function docsOf(canonical: string): { readonly readme: string; readonly source: string } {
  const docs = DOC_SURFACES[canonical]
  if (docs === undefined) throw new Error('no doc surfaces declared for canonical row ' + canonical)
  return docs
}

describe('deprecated parameter aliases are documented (G0/S0.3)', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))

  it('covers every alias with both doc surfaces', () => {
    for (const canonical of Object.values(PARAM_ALIASES)) {
      const docs = docsOf(canonical)
      for (const rel of [docs.readme, docs.source]) {
        expect(() => readFileSync(join(root, rel), 'utf8'), rel).not.toThrow()
      }
    }
  })

  it('names the alias, the canonical id and the marker in README and source docs', () => {
    for (const [alias, canonical] of Object.entries(PARAM_ALIASES)) {
      const docs = docsOf(canonical)
      for (const rel of [docs.readme, docs.source]) {
        const text = readFileSync(join(root, rel), 'utf8')
        expect(text, rel + ' names ' + alias).toContain(alias)
        expect(text, rel + ' names ' + canonical).toContain(canonical)
        expect(text, rel + ' carries the G0/S0.3 marker').toMatch(MARKER)
      }
    }
  })
})
