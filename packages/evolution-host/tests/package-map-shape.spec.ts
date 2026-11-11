// @tier ci-only
import { describe, expect, it, vi } from 'vitest'
// Child-process spawns slow down under full-suite parallel load (audit v10 fix).
vi.setConfig({ testTimeout: 30_000 })
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempRoot } from '../../test-support/temp-home.ts'

const run = promisify(execFile)
const scripts = fileURLToPath(new URL('../../scripts', import.meta.url))

// W7.2 (2026-11-11): the 0.43.2-rc.1 incident, pinned. That release commit swept 6510 untracked files
// into the repository — 22 platform package groups, at the repo root and under packages/, reached
// THROUGH the junctions that D:/dsh/_tools/setup-mirror-tests.mjs wires in — and the guard that reads
// the package map said OK, because those groups carry no package.json of their own. The release
// overlay copies `packages/.` wholesale into `packages/evolution/`, so they then read as family code
// and verify-arch-guards reported 399 violations on the platform's own sources (tag run 42974791881).
//
// This lives OUTSIDE guard-scripts.spec.ts on purpose: four mutation probes (decl-client-seats,
// decl-dependency-closure, decl-platform-contract, decl-doc-facts) sign that file's bytes, so adding
// sentinel cases there invalidates four ledger signatures for reasons unrelated to what those probes
// prove. A guard's sentinels belong wherever they can be added without spending other probes' evidence.
describe('package-map tree shape (W7.2 sentry)', () => {
  const packageMap = join(scripts, 'verify-package-map.mjs')
  const readme = (row: string): string => '# packages\n\n## Package map\n\n| package | what |\n|---|---|\n' + row + '\n'

  it('passes when every directory is published or declared non-package', async () => {
    const root = await tempRoot('package-map-clean-')
    await mkdir(join(root, 'demo-a'), { recursive: true })
    await writeFile(join(root, 'demo-a', 'package.json'), JSON.stringify({ name: 'demo-a' }), 'utf8')
    await mkdir(join(root, 'scripts'), { recursive: true })
    await mkdir(join(root, 'test-support'), { recursive: true })
    await writeFile(join(root, 'README.md'), readme('| `demo-a` | demo |'), 'utf8')
    const { stdout } = await run(process.execPath, [packageMap, root], { encoding: 'utf8' })
    expect(stdout).toContain('1 published package(s)')
  })

  it('rejects a platform grouping directory that carries no manifest of its own', async () => {
    const root = await tempRoot('package-map-stray-')
    await mkdir(join(root, 'demo-a'), { recursive: true })
    await writeFile(join(root, 'demo-a', 'package.json'), JSON.stringify({ name: 'demo-a' }), 'utf8')
    // The platform nests its packages one level deeper, so `api` itself has no package.json — the
    // exact shape the published-package rule could not see.
    await mkdir(join(root, 'api', 'gateway'), { recursive: true })
    await writeFile(join(root, 'api', 'gateway', 'package.json'), JSON.stringify({ name: 'demo-gateway' }), 'utf8')
    await writeFile(join(root, 'README.md'), readme('| `demo-a` | demo |'), 'utf8')
    const failed = await run(process.execPath, [packageMap, root], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(failed?.code).toBe(1)
    expect(failed?.stderr).toContain('is neither a published package')
  })

  it('fails on a vacuum root instead of reporting an empty pass', async () => {
    const root = await tempRoot('package-map-vacuum-')
    await writeFile(join(root, 'README.md'), readme(''), 'utf8')
    const failed = await run(process.execPath, [packageMap, root], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(failed?.code).toBe(1)
    expect(failed?.stderr).toContain('carries no publishable package')
  })

  // The 0.43.2-rc.1 worktree did not carry copied directories: it carried JUNCTIONS to the platform
  // tree, and a Node Dirent reports a junction as isSymbolicLink() with isDirectory() false. A scan
  // that filters on isDirectory() therefore passes on the release machine and the incident ships.
  it('rejects a junction that points at a platform group', async () => {
    const base = await tempRoot('package-map-junction-')
    const root = join(base, 'packages')
    await mkdir(join(root, 'demo-a'), { recursive: true })
    await writeFile(join(root, 'demo-a', 'package.json'), JSON.stringify({ name: 'demo-a' }), 'utf8')
    await writeFile(join(root, 'README.md'), readme('| `demo-a` | demo |'), 'utf8')
    await mkdir(join(base, 'platform-api', 'gateway'), { recursive: true })
    await symlink(join(base, 'platform-api'), join(root, 'api'), process.platform === 'win32' ? 'junction' : 'dir')
    const failed = await run(process.execPath, [packageMap, root], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(failed?.code).toBe(1)
    expect(failed?.stderr).toContain('junction/symlink')
  })

  // The same copy also landed at the repository ROOT, which the package-root scan cannot see.
  it('rejects scaffolding at the repository root of the mirror layout', async () => {
    const base = await tempRoot('package-map-root-')
    const root = join(base, 'packages')
    await mkdir(join(root, 'demo-a'), { recursive: true })
    await writeFile(join(root, 'demo-a', 'package.json'), JSON.stringify({ name: 'demo-a' }), 'utf8')
    await writeFile(join(root, 'README.md'), readme('| `demo-a` | demo |'), 'utf8')
    await mkdir(join(base, 'interaction', 'commands'), { recursive: true })
    const failed = await run(process.execPath, [packageMap, root], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(failed?.code).toBe(1)
    expect(failed?.stderr).toContain('sits at the repository root')
  })
})
