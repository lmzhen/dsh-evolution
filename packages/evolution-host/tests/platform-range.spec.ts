// @tier ci-only
import { describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const guard = fileURLToPath(new URL('../../scripts/verify-platform-ranges.mjs', import.meta.url))
const PEERS = '^0.2.1-rc.1'
const ENGINES = '>=0.2.1-rc.1 <0.2.2-0'

async function stagedDir(packages: Array<Record<string, unknown>>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-range-'))
  for (const [index, pkg] of packages.entries()) {
    const dir = join(root, 'pkg-' + index)
    await mkdir(dir)
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg))
  }
  return root
}

function manifest(extra: Record<string, unknown> = {}) {
  return {
    name: '@lmzhen/dsh-evolution-host',
    engines: { node: '>=22', dsh: ENGINES },
    dependencies: {
      '@deepseek-ai/dsh-llm': PEERS,
      '@lmzhen/dsh-evolution-core': '^0.26.26',
    },
    ...extra,
  }
}

async function runGuard(args: string[]) {
  return run(process.execPath, [guard, ...args], { encoding: 'utf8' })
    .then((result) => ({ code: 0, stdout: result.stdout, stderr: result.stderr }), (caught: unknown) => {
      const error = caught as { code?: number; stdout?: string; stderr?: string }
      return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    })
}

async function cleanup(root: string) { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }

describe('verify-platform-ranges (G1-S6 range guard)', () => {
  it('passes when peers/engines/vendored all match the platform line, and prints both predicate tables', async () => {
    const root = await stagedDir([
      manifest(),
      { name: '@lmzhen/dsh-evolution-core', engines: { dsh: ENGINES }, peerDependencies: { '@deepseek-ai/dsh-session': PEERS, '@deepseek-ai/cordis-plugin-include': '^1.0.10' } },
    ])
    const result = await runGuard(['--manifest-dir', root])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('platform peers')
    expect(result.stdout).toContain('platform engines')
    expect(result.stdout).toContain('OK')
    await cleanup(root)
  })

  it('fails on a drifted platform range and names the offender + expected range', async () => {
    const root = await stagedDir([manifest({ peerDependencies: { '@deepseek-ai/dsh-llm': '^0.2.0-rc.1' } })])
    const result = await runGuard(['--manifest-dir', root])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('dsh-llm')
    expect(result.stderr).toContain(PEERS)
    await cleanup(root)
  })

  it('fails when engines.dsh is missing or drifted', async () => {
    const missing = await stagedDir([{ name: '@lmzhen/dsh-evolution-host', dependencies: { '@deepseek-ai/dsh-llm': PEERS } }])
    const missingResult = await runGuard(['--manifest-dir', missing])
    expect(missingResult.code).toBe(1)
    expect(missingResult.stderr).toContain('engines.dsh')
    await cleanup(missing)
    const drifted = await stagedDir([manifest({ engines: { dsh: '>=0.2.1-rc.1 <0.2.3-0' } })])
    const driftedResult = await runGuard(['--manifest-dir', drifted])
    expect(driftedResult.code).toBe(1)
    expect(driftedResult.stderr).toContain(ENGINES)
    await cleanup(drifted)
  })

  it('fails on a surviving workspace literal and on an unknown vendored dependency', async () => {
    const workspaceRoot = await stagedDir([manifest({ dependencies: { '@deepseek-ai/dsh-llm': 'workspace:^' } })])
    const workspaceResult = await runGuard(['--manifest-dir', workspaceRoot])
    expect(workspaceResult.code).toBe(1)
    expect(workspaceResult.stderr).toContain('workspace literal')
    await cleanup(workspaceRoot)
    const vendoredRoot = await stagedDir([manifest({ dependencies: { '@deepseek-ai/dsh-llm': PEERS, '@deepseek-ai/vendor-x': '^1.0.0' } })])
    const vendoredResult = await runGuard(['--manifest-dir', vendoredRoot])
    expect(vendoredResult.code).toBe(1)
    expect(vendoredResult.stderr).toContain('no vendored range rule')
    await cleanup(vendoredRoot)
  })

  it('pins the vendor table (include range must be the validated upstream version)', async () => {
    const root = await stagedDir([manifest({ dependencies: { '@deepseek-ai/dsh-llm': PEERS, '@deepseek-ai/cordis-plugin-include': '^1.0.9' } })])
    const result = await runGuard(['--manifest-dir', root])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('^1.0.10')
    await cleanup(root)
  })

  it('rejects --our-scope @deepseek-ai so the guard cannot go silent', async () => {
    const root = await stagedDir([manifest()])
    const result = await runGuard(['--manifest-dir', root, '--our-scope', '@deepseek-ai'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--family-prefixes')
    await cleanup(root)
  })

  it('fails loud when no manifest is actually scanned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-platform-range-empty-'))
    const result = await runGuard(['--manifest-dir', root])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('no package manifest found')
    await cleanup(root)
  })
})
