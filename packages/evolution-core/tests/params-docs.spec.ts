// @tier pre-tag
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

/** Absorbed rows keep their id; their docs and sources live under the host package. */
const OWNER_DOCS: Record<string, { readme: string; source: string }> = {
  'memory-files': { readme: 'memory/docs/files/README.md', source: 'memory/src/files/index.ts' },
  'tool-memory': { readme: 'memory/docs/tools/README.md', source: 'memory/src/tools/index.ts' },
  'skill-usage': { readme: 'evolution-skill-discovery/docs/usage/README.md', source: 'evolution-skill-discovery/src/usage/index.ts' },
  'evolution-skill-catalog': { readme: 'evolution-skill-discovery/docs/catalog/README.md', source: 'evolution-skill-discovery/src/catalog/index.ts' },
  'evolution-skill-health': { readme: 'evolution-skill-discovery/docs/health/README.md', source: 'evolution-skill-discovery/src/health/index.ts' },
  'evolution-feedback': { readme: 'evolution-activity/docs/feedback/README.md', source: 'evolution-activity/src/feedback/index.ts' },
  'evolution-replay': { readme: 'evolution-activity/docs/replay/README.md', source: 'evolution-activity/src/replay/index.ts' },
  'evolution-learning-graph': { readme: 'evolution-activity/docs/learning-graph/README.md', source: 'evolution-activity/src/learning-graph/index.ts' },
  'evolution-threat': { readme: 'evolution-activity/docs/threat/README.md', source: 'evolution-activity/src/threat/index.ts' },
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
      const docs = OWNER_DOCS[owner]
      const readme = join(root, docs === undefined ? owner + '/README.md' : docs.readme)
      const source = join(root, docs === undefined ? owner + '/src/index.ts' : docs.source)
      expect(() => readFileSync(readme, 'utf8'), readme).not.toThrow()
      expect(() => readFileSync(source, 'utf8'), source).not.toThrow()
    }
  })

  it('names the alias, the canonical id and the marker in README and Config JSDoc', () => {
    for (const [alias, canonical] of Object.entries(PARAM_ALIASES)) {
      const owner = ownerOf(canonical)
      const docs = OWNER_DOCS[owner]
      const readme = readFileSync(join(root, docs === undefined ? owner + '/README.md' : docs.readme), 'utf8')
      const source = readFileSync(join(root, docs === undefined ? owner + '/src/index.ts' : docs.source), 'utf8')
      for (const [label, text] of [['README', readme], ['src/index.ts', source]] as const) {
        expect(text, owner + ' ' + label + ' names ' + alias).toContain(alias)
        expect(text, owner + ' ' + label + ' names ' + canonical).toContain(canonical)
        expect(text, owner + ' ' + label + ' carries the G0/S0.3 marker').toMatch(MARKER)
      }
    }
  })
})
