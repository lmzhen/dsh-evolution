import { describe, expect, it, vi } from 'vitest'
// Child-process spawns slow down under full-suite parallel load; the vitest
// default 5s per test is too tight for multiple node spawns (audit v10 fix).
vi.setConfig({ testTimeout: 30_000 })
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempRoot } from '../../test-support/temp-home.ts'

const run = promisify(execFile)
const guard = fileURLToPath(new URL('../../scripts/verify-layout-sync.mjs', import.meta.url))

async function fakeTrees(devContent: string, mirrorContent: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-layout-sync-'))
  const dev = join(root, 'dev')
  const mirror = join(root, 'mirror')
  await mkdir(dev)
  await mkdir(mirror)
  await writeFile(join(dev, 'a.mjs'), devContent)
  await writeFile(join(mirror, 'a.mjs'), mirrorContent)
  return { root, dev, mirror }
}

/** V9-01 fixture: a complete mirror layout whose repoRoot (mirrorDir/../..)
 * carries CHANGELOG.md + root manifest + packages/, with the two scripts dirs
 * nested one directory below the packages/ level — mirroring the real layout
 * (<repo>/packages/scripts -> repoRoot <repo>). */
async function versionedTree(head: string, packages: Record<string, string>) {
  const outer = await mkdtemp(join(tmpdir(), 'dsh-layout-sync-ver-'))
  const root = join(outer, 'tree')
  await mkdir(join(root, 'packages', 'alpha'), { recursive: true })
  await mkdir(join(root, 'packages', 'beta'), { recursive: true })
  await mkdir(join(root, 'packages', 'scripts-dev'), { recursive: true })
  await mkdir(join(root, 'packages', 'scripts-mirror'), { recursive: true })
  await writeFile(join(root, 'CHANGELOG.md'), `# Changelog\n\n## ${head}\n\n- entry\n`)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'dsh-evolution', version: head }))
  for (const [name, version] of Object.entries(packages)) {
    await writeFile(join(root, 'packages', name, 'package.json'), JSON.stringify({ name: `@deepseek-ai/dsh-${name}`, version }))
  }
  await writeFile(join(root, 'packages', 'scripts-dev', 'a.mjs'), 'export {}\n')
  await writeFile(join(root, 'packages', 'scripts-mirror', 'a.mjs'), 'export {}\n')
  return { root }
}

describe('verify-layout-sync (P1-② layout drift guard)', () => {
  it('requires both paths and refuses to run without them (M-5)', async () => {
    const error = await run(process.execPath, [guard], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('both required')
  })

  it('passes when scripts are identical modulo line endings', async () => {
    const { root, dev, mirror } = await fakeTrees('line one\nline two\n', 'line one\r\nline two\r\n')
    const { stdout } = await run(process.execPath, [guard, dev, mirror], { encoding: 'utf8' })
    expect(stdout).toContain('OK')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('fails and names the drifted file when content differs', async () => {
    const { root, dev, mirror } = await fakeTrees('line one\n', 'line one changed\n')
    const error = await run(process.execPath, [guard, dev, mirror], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('a.mjs')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('fails when a file exists on only one side', async () => {
    const root = await tempRoot('dsh-layout-sync-2-')
    const dev = join(root, 'dev')
    const mirror = join(root, 'mirror')
    await mkdir(dev)
    await mkdir(mirror)
    await writeFile(join(dev, 'only-dev.mjs'), 'x')
    const error = await run(process.execPath, [guard, dev, mirror], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error?.stderr).toContain('only-dev.mjs')
  })

  // P2-15 / V9-01 (0.3.50): the version half of the guard — mirror CHANGELOG
  // head must equal the root manifest AND every package manifest version. The
  // real incident rewrote 30 manifests to 0.1.0-rc.1 and four releases passed
  // with nothing catching it; these cases pin the check the CI step (P2-15)
  // now runs. Fixture layout note: repoRoot = resolve(mirrorDir, '..', '..'),
  // so the versioned tree sits at <root> with the scripts dirs two levels in.
  it('V9-01: version guard passes when CHANGELOG head, root and package manifests align', async () => {
    const { root } = await versionedTree('1.2.3', { alpha: '1.2.3', beta: '1.2.3' })
    const { stdout } = await run(process.execPath, [guard, join(root, 'packages', 'scripts-dev'), join(root, 'packages', 'scripts-mirror')], { encoding: 'utf8' })
    expect(stdout).toContain('versions align')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V9-01: version guard fails and names the manifest that drifted from the CHANGELOG head', async () => {
    const { root } = await versionedTree('1.2.3', { alpha: '1.2.3', beta: '0.1.0-rc.1' })
    const error = await run(process.execPath, [guard, join(root, 'packages', 'scripts-dev'), join(root, 'packages', 'scripts-mirror')], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('beta')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})
