// @tier pre-tag
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const clientRoot = fileURLToPath(new URL('../../src/client/', import.meta.url))
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const sources = readdirSync(clientRoot).filter(name => name.endsWith('.ts') && !name.endsWith('.spec.ts'))

it('RG7 UI consumes wireVersion, ActionRef, and imports no write model', () => {
  const all = sources.map(name => readFileSync(join(clientRoot, name), 'utf8')).join('\n')
  expect(all).toContain('wireVersion !== 1')
  expect(all).toContain('disabledReason')
  expect(all).toContain('confirm')
  expect(all).not.toContain('@deepseek-ai/dsh-evolution-merge')
  expect(all).not.toContain('@deepseek-ai/dsh-evolution-core')
  expect(all).not.toContain('transactRows')
  expect(all).not.toContain('upsertRow')
  // v3 H2: the UI owns exactly ONE write: the decision route (rowId + verb + sessionId).
  // Commands remain copy-only; any second POST is a second write model and fails here.
  const posts = all.match(/method:\s*['"]POST['"]/g) ?? []
  expect(posts).toHaveLength(1)
  const apiSource = readFileSync(join(clientRoot, 'api.ts'), 'utf8')
  expect(apiSource).toContain("replace(/body$/, 'decision')")
  expect(apiSource).toContain('rowId, verb, sessionId')
  const deps = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).dependencies ?? {}
  expect(Object.keys(deps).some(name => name.includes('dsh-evolution-merge') || name.includes('dsh-evolution-core'))).toBe(false)
})
