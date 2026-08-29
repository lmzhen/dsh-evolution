import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { insertedRows, rowIds } from '../../test-support/cordis-rows.ts'

const run = promisify(execFile)
const installer = fileURLToPath(new URL('../../scripts/install-layered.mjs', import.meta.url))

async function runInstaller(home: string, mode: string, profile = 'evo-test', extra: string[] = [], env: Record<string, string> = {}) {
  return run(process.execPath, [installer, '--mode', mode, '--profile', profile, '--home', home, ...extra], { env: { ...process.env, ...env } })
}

describe('layered installer', () => {
  it('installs host bundle + agent preset into a clean DSH_HOME', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-'))
    const { stdout } = await runInstaller(home, 'layered')
    const profileDir = join(home, 'profiles', 'evo-test')
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).toContain('@deepseek-ai/dsh-evolution-host')

    // Source installs without built lib/index.js must say so instead of
    // silently producing a profile that cannot boot; a built tree just boots.
    const builtMarker = fileURLToPath(new URL('../../evolution-core/lib/index.js', import.meta.url))
    if (existsSync(builtMarker)) expect(stdout).not.toContain('unbuilt:')
    else expect(stdout).toContain('unbuilt:')
    const sourceTypes = fileURLToPath(new URL('../../evolution-state-json/lib/types/index.d.ts', import.meta.url))
    if (existsSync(sourceTypes)) {
      await expect(readFile(
        join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-state-json/lib/types/index.d.ts'),
        'utf8',
      )).resolves.toContain('evolution-state-json')
    }

    const presetDir = join(home, '.agent-presets', 'evolution')
    const composition = await readFile(join(presetDir, 'agent.cordis.yml'), 'utf8')
    // rc.53: the installed preset is GENERATED from the runtime platform's
    // standard rows + the evolution delta — standard rows verbatim first
    // (persona is one), then the delta's model tools.
    expect(composition).toContain('- id: persona')
    expect(composition.indexOf('- id: persona')).toBeLessThan(composition.indexOf('- id: tool-memory'))
    expect(composition).toContain('- id: tool-memory')
    expect(composition).toContain('- id: evolution-skill-catalog')

    const patchRows = insertedRows(loadOverlayPatches('test', join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-host/cordis.patch.yml')))
    expect(rowIds(patchRows)).toContain('evolution-review')

    await rm(home, { recursive: true, force: true })
  }, 20_000)

  it('installs the compatibility one-click bundle', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-oneclick-'))
    await runInstaller(home, 'oneclick', 'web')
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).toContain('@deepseek-ai/dsh-evolution-preset')
    await rm(home, { recursive: true, force: true })
  })

  it('uninstalls the layered installation without touching user data', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-uninstall-'))
    await runInstaller(home, 'layered')
    await runInstaller(home, 'layered', 'evo-test', ['--uninstall'])
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'evo-test', 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).toEqual([])
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

  it('rejects a delta that collides with runtime standard rows (N-5)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-n5-'))
    const standard = '# runtime standard\n- id: persona\n- id: tool-session-query\n- id: dsh-tools\n'
    const delta = '# evolution delta\n- id: tool-memory\n- id: tool-session-query\n'
    await mkdir(join(home, 'preset', 'standard'), { recursive: true })
    await writeFile(join(home, 'preset', 'standard', 'agent.cordis.yml'), standard)
    await writeFile(join(home, 'delta.yml'), delta)
    const error = await runInstaller(home, 'layered', 'evo-n5', ['--dry-run'], {
      DSH_AGENT_PRESET_ROOT: join(home, 'preset'),
      DSH_EVOLUTION_DELTA_PATH: join(home, 'delta.yml'),
    }).then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.stderr).toContain('tool-session-query')
    await rm(home, { recursive: true, force: true })
  }, 20_000)

  it('keeps both rows under the DSH_EVOLUTION_ALLOW_ROW_COLLISIONS escape (N-5)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-n5b-'))
    const standard = '- id: persona\n- id: tool-session-query\n'
    const delta = '- id: tool-memory\n- id: tool-session-query\n'
    await mkdir(join(home, 'preset', 'standard'), { recursive: true })
    await writeFile(join(home, 'preset', 'standard', 'agent.cordis.yml'), standard)
    await writeFile(join(home, 'delta.yml'), delta)
    const { stderr } = await runInstaller(home, 'layered', 'evo-n5b', ['--dry-run'], {
      DSH_AGENT_PRESET_ROOT: join(home, 'preset'),
      DSH_EVOLUTION_DELTA_PATH: join(home, 'delta.yml'),
      DSH_EVOLUTION_ALLOW_ROW_COLLISIONS: '1',
    })
    expect(stderr).toContain('collide with standard rows')
    await rm(home, { recursive: true, force: true })
  }, 20_000)
})
