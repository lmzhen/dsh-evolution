import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { insertedRows, rowName } from '../../test-support/cordis-rows.ts'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  name: string
  dependencies: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

it('evolution-all aggregates the host entry, the four model-tool entries and the preset container (0.3.54)', () => {
  expect(manifest.name).toBe('@deepseek-ai/dsh-evolution-all')
  const expected = [
    '@deepseek-ai/dsh-evolution-host',
    '@deepseek-ai/dsh-tool-memory',
    '@deepseek-ai/dsh-tool-skill-manage',
    '@deepseek-ai/dsh-tool-session-query',
    '@deepseek-ai/dsh-evolution-skill-catalog',
    '@deepseek-ai/dsh-evolution-agent-preset',
  ]
  for (const dep of expected) {
    expect(manifest.dependencies[dep], `${dep} must be a dependency of evolution-all`).toBe('workspace:^')
  }
  expect(Object.keys(manifest.dependencies).sort()).toEqual([...expected].sort())
})

it('G-C: every model row package named by the all.patch resolves in the dependency closure (0.3.54)', () => {
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  const rows = insertedRows(loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))))
  // The infra rows are evolution-host's own contract (G-A pins the row bodies
  // to host.patch, whose dependency-contract covers them); all's OWN closure
  // must cover the four model rows plus the host package itself.
  const declared = new Set([...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies ?? {})])
  const modelNames = ['@deepseek-ai/dsh-tool-memory', '@deepseek-ai/dsh-tool-skill-manage', '@deepseek-ai/dsh-tool-session-query', '@deepseek-ai/dsh-evolution-skill-catalog']
  for (const row of rows) {
    const name = rowName(row)
    if (name.startsWith('@deepseek-ai/') && modelNames.includes(name)) {
      expect(declared.has(name), `row ${name} must be declared by evolution-all`).toBe(true)
    }
  }
  expect(declared.has('@deepseek-ai/dsh-evolution-host')).toBe(true)
})

// 0.3.54 (route B): all is the DEFAULT full-functionality bundle — the
// install story inverts: `dsh plugin add @lmzhen/dsh-evolution-all` mounts the
// infra AND the model tools at profile root ("most complete first"); package
// selection (host) is the shrink path; layered preset stays the per-session
// advanced channel. Both doc surfaces must state that inversion, or the old
// "one command installs everything but mounts only infra" (H-08) promise
// creeps back.
it('documents the full-bundle default: all = infra + model tools, host = shrink path (0.3.54)', () => {
  const readme = readFileSync(join(here, '..', 'README.md'), 'utf8')
  expect(readme).toContain('DEFAULT install')
  expect(readme).toContain('model tools')
  expect(readme).toContain('shrink')
  const entry = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8')
  expect(entry).toContain('full-functionality')
  expect(entry.toLowerCase()).toContain('profile-root')
  expect(entry).not.toContain('hidden')
})
