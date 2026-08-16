import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const run = promisify(execFile)
const installer = fileURLToPath(new URL('../../scripts/install-layered.mjs', import.meta.url))

async function runInstaller(home: string, mode: string, profile = 'evo-test', extra: string[] = []) {
  return run(process.execPath, [installer, '--mode', mode, '--profile', profile, '--home', home, ...extra])
}

describe('layered installer', () => {
  it('installs host bundle + agent preset into a clean DSH_HOME', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-'))
    await runInstaller(home, 'layered')
    const profileDir = join(home, 'profiles', 'evo-test')
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('@deepseek-ai/dsh-evolution-host')

    const presetDir = join(home, '.agent-presets', 'evolution')
    expect(await readFile(join(presetDir, 'agent.cordis.yml'), 'utf8')).toContain('tool-memory')

    const patch = loadOverlayPatches('test', join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-host/cordis.patch.yml')) as any[]
    expect((patch[0]!.insert as any[]).map((row: any) => row.id)).toContain('evolution-review')

    await rm(home, { recursive: true, force: true })
  })

  it('installs the compatibility one-click bundle', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-oneclick-'))
    await runInstaller(home, 'oneclick', 'web')
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('@deepseek-ai/dsh-evolution-preset')
    await rm(home, { recursive: true, force: true })
  })

  it('uninstalls the layered installation without touching user data', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-uninstall-'))
    await runInstaller(home, 'layered')
    await runInstaller(home, 'layered', 'evo-test', ['--uninstall'])
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'evo-test', 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toEqual([])
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(join(home, 'profiles', 'evo-test', 'node_modules/@deepseek-ai'))).toHaveLength(0)
    await rm(home, { recursive: true, force: true })
  })

  it('does not write profile files in dry-run mode', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-dry-'))
    await runInstaller(home, 'layered')
    await rm(home, { recursive: true, force: true })
    const dryHome = await mkdtemp(join(tmpdir(), 'dsh-installer-dry2-'))
    const { stdout } = await runInstaller(dryHome, 'layered', 'evo-test', ['--dry-run'])
    expect(stdout).toContain('dry-run:  no files were written')
    await expect(readFile(join(dryHome, 'profiles', 'evo-test', 'package.json'), 'utf8')).rejects.toThrow()
    await rm(dryHome, { recursive: true, force: true })
  })
})
