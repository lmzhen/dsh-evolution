// @tier ci-only
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

it('keeps main-entry as the only production root', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { main: string; exports: Record<string, { default?: string }> }
  expect(pkg.main).toBe('lib/main-entry.js')
  expect(pkg.exports['.']?.default).toBe('./lib/main-entry.js')
  expect(pkg.exports['./search']).toBeUndefined()
  expect(pkg.exports['./domain']).toBeUndefined()
})
