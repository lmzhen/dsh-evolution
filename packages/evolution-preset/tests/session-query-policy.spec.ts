// @tier pre-tag
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const patches = ['evolution-host', 'evolution-all', 'evolution-preset']

it('enables the native session-query index with the acknowledged keys', () => {
  for (const pkg of patches) {
    const path = fileURLToPath(new URL('../../' + pkg + '/cordis.patch.yml', import.meta.url))
    const patch = readFileSync(path, 'utf8')
    // The roster's tail row turns the platform SQLite index on so session_search
    // has a backing index; the override is deliberate and complete.
    expect(patch, pkg).toContain('- id: session-query-sqlite')
    expect(patch, pkg).toContain('path: !!js')
    expect(patch, pkg).toContain('openAt: !!js')
    expect(patch, pkg).toContain('DSH_EVOLUTION_SESSION_QUERY')
  }
})
