import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const guard = fileURLToPath(new URL('../../scripts/verify-platform-ranges.mjs', import.meta.url))

async function stagedDir(packages: Array<{ name: string; [section: string]: unknown }>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-range-'))
  for (const [index, pkg] of packages.entries()) {
    const dir = join(root, `pkg-${index}`)
    await mkdir(dir)
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg))
  }
  return root
}

describe('verify-platform-ranges (N-2 guard)', () => {
  it('passes when every @deepseek-ai/dsh-* range matches the platform version', async () => {
    const root = await stagedDir([
      {
        name: '@lmzhen/dsh-evolution-host',
        dependencies: {
          '@deepseek-ai/dsh-llm': '^0.1.1-rc.2',
          // Family-scoped packages range against their OWN release version.
          '@lmzhen/dsh-evolution-core': '^0.1.0-rc.55',
        },
      },
      {
        name: '@lmzhen/dsh-evolution-core',
        peerDependencies: { '@deepseek-ai/dsh-session': '^0.1.1-rc.2' },
      },
    ])
    const { stdout } = await run(process.execPath, [guard, '--platform-version', '0.1.1-rc.2', '--manifest-dir', root], { encoding: 'utf8' })
    expect(stdout).toContain('OK')
    await rm(root, { recursive: true, force: true })
  })

  it('fails on a drifted dsh-* platform range and names the offender', async () => {
    const root = await stagedDir([
      { name: '@lmzhen/dsh-evolution-host', peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.0-rc.6' } },
    ])
    const error = await run(process.execPath, [guard, '--platform-version', '0.1.1-rc.2', '--manifest-dir', root], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('dsh-llm')
    expect(error?.stderr).toContain('^0.1.1-rc.2')
    await rm(root, { recursive: true, force: true })
  })

  it('rejects --our-scope @deepseek-ai so the guard cannot go silent (M-7)', async () => {
    const root = await stagedDir([
      { name: '@lmzhen/dsh-evolution-host', dependencies: { '@deepseek-ai/dsh-llm': '^0.1.1-rc.2' } },
    ])
    const error = await run(process.execPath, [guard, '--platform-version', '0.1.1-rc.2', '--manifest-dir', root, '--our-scope', '@deepseek-ai'], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('--family-prefixes')
    await rm(root, { recursive: true, force: true })
  })

  it('tolerates missing manifests and empty manifest dirs', async () => {
    const root = await stagedDir([{ name: '@lmzhen/dsh-evolution-host' }])
    await writeFile(join(root, 'pkg-0', 'package.json'), '{not json')
    const { stdout } = await run(process.execPath, [guard, '--platform-version', '0.1.1-rc.2', '--manifest-dir', root], { encoding: 'utf8' })
    expect(stdout).toContain('OK')
    await rm(root, { recursive: true, force: true })
  })
})
