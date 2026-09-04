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
