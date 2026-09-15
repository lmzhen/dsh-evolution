import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// v43 S1-6: the skill-root gate must catch a deployment that points ONE row at
// a different skill tree (the maintenance sweep then audits that tree and
// reports clean). Real-tree-green is only half the evidence — this spec builds
// the fixtures in TypeScript (never PowerShell string surgery) and asserts the
// RED half too.
const script = fileURLToPath(new URL('../../scripts/verify-skill-roots.mjs', import.meta.url))
const repoPackages = fileURLToPath(new URL('../../', import.meta.url))

async function fixture(rows: Array<{ pkg: string; root: string | null }>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skillroots-'))
  for (const row of rows) {
    const dir = join(root, 'packages', row.pkg)
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@x/' + row.pkg, version: '1.0.0' }))
    await writeFile(join(dir, 'src', 'index.ts'), 'export const r = () => resolveSkillsRoot({})' + String.fromCharCode(10))
    const lines = ['- id: ' + row.pkg + '-row', "  name: '@x/" + row.pkg + "'"]
    if (row.root !== null) lines.push('  config:', '    root: ' + row.root)
    await writeFile(join(dir, 'cordis.patch.yml'), lines.join(String.fromCharCode(10)) + String.fromCharCode(10))
  }
  return root
}

function exitOf(packagesRoot: string): number {
  try {
    execFileSync(process.execPath, [script, packagesRoot, '--strict'], { encoding: 'utf8', stdio: 'pipe' })
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? 1
  }
}

describe('verify-skill-roots (S1-6)', () => {
  it('the real tree passes (no shipped config declares a skill root today)', () => {
    expect(exitOf(repoPackages)).toBe(0)
  })

  it('RED: two skill-root rows pointed at different trees fail the gate', async () => {
    const root = await fixture([
      { pkg: 'dsh-evolution-alpha', root: 'C:/trees/a' },
      { pkg: 'dsh-evolution-beta', root: 'C:/trees/b' },
    ])
    try { expect(exitOf(join(root, 'packages'))).toBe(1) } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('two rows on the SAME tree pass, and a row without a root is not a disagreement', async () => {
    const root = await fixture([
      { pkg: 'dsh-evolution-alpha', root: 'C:/trees/a' },
      { pkg: 'dsh-evolution-beta', root: 'C:/trees/a' },
      { pkg: 'dsh-evolution-gamma', root: null },
    ])
    try { expect(exitOf(join(root, 'packages'))).toBe(0) } finally { await rm(root, { recursive: true, force: true }) }
  })
})
