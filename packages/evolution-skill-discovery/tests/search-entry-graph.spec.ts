// @tier ci-only
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

it('keeps the production search entry off the domain/projection graph', async () => {
  const source = await readFile(new URL('../src/search-entry.ts', import.meta.url), 'utf8')
  for (const forbidden of ['domain-', 'adapter', 'runtime', 'assignment', 'shadow-evidence', 'session-store']) {
    expect(source).not.toContain(forbidden)
  }
})
