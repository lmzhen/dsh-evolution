// @tier pre-tag
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const patches = ['evolution-host', 'evolution-all', 'evolution-preset']

it('does not override the platform session-query policy', () => {
  for (const pkg of patches) {
    const path = fileURLToPath(new URL(`../../${pkg}/cordis.patch.yml`, import.meta.url))
    const patch = readFileSync(path, 'utf8')
    expect(patch, pkg).not.toContain('session-query-sqlite')
    expect(patch, pkg).not.toContain('DSH_EVOLUTION_SESSION_QUERY')
  }
})
