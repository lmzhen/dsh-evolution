import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  name: string
  dependencies: Record<string, string>
}

it('evolution-all aggregates the host entry, the three model-tool entries and the preset container (0.3.14)', () => {
  expect(manifest.name).toBe('@deepseek-ai/dsh-evolution-all')
  const expected = [
    '@deepseek-ai/dsh-evolution-host',
    '@deepseek-ai/dsh-tool-memory',
    '@deepseek-ai/dsh-tool-skill-manage',
    '@deepseek-ai/dsh-evolution-skill-catalog',
    '@deepseek-ai/dsh-evolution-agent-preset',
  ]
  for (const dep of expected) {
    expect(manifest.dependencies[dep], `${dep} must be a dependency of evolution-all`).toBe('workspace:^')
  }
  // host already spans the rest of the infra/control plane; these five are
  // the complete entry set (the preset container closes the P1-1 delivery gap).
  expect(Object.keys(manifest.dependencies).sort()).toEqual([...expected].sort())
})

// H-08: "one command installs everything" overpromised — the
// aggregate mounts only the host bundle; the model-facing tool rows ride the
// Evolution agent preset and NOTHING auto-registers that preset. Both doc
// surfaces must state the post-install requirement (install-layered --mode
// agent, or a manually produced/selected Evolution preset), or the promise
// creeps back.
it('documents that the aggregate install does not auto-register the model tools (H-08)', () => {
  const readme = readFileSync(join(here, '..', 'README.md'), 'utf8')
  expect(readme).toContain('only the host bundle')
  expect(readme).toContain('install-layered --mode agent')
  expect(readme).toContain('/evolution preset install')
  const entry = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8')
  expect(entry).toContain('install-layered --mode agent')
  expect(entry).toContain('/evolution preset')
  expect(entry).toContain('H-08')
})
