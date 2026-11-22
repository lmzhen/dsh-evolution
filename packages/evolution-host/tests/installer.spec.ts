// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { insertedRows, rowIds } from '../../test-support/cordis-rows.ts'
import { tempRoot } from '../../test-support/temp-home.ts'
// @ts-expect-error -- plain ESM installer helper
import { scopedName } from '../../scripts/install-layered.mjs'

const run = promisify(execFile)
const installer = fileURLToPath(new URL('../../scripts/install-layered.mjs', import.meta.url))
const installerUrl = new URL('../../scripts/install-layered.mjs', import.meta.url).href

/** Evaluate a value inside a fresh node process that imported the installer. */
async function callInstaller(body: string): Promise<unknown> {
  const script = [
    `import * as installer from ${JSON.stringify(installerUrl)}`,
    `const value = await (async () => { ${body} })()`,
    'process.stdout.write(Buffer.from(JSON.stringify(value), "utf8").toString("base64"))',
  ].join('\n')
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script])
  return JSON.parse(Buffer.from(stdout, 'base64').toString('utf8'))
}

it('P1-14: scope stripping uses the destination scope, so the community kit is not nested', () => {
  expect(scopedName('@lmzhen/dsh-evolution-client-kit', '@lmzhen')).toBe('dsh-evolution-client-kit')
  expect(scopedName('@deepseek-ai/dsh-evolution-host', '@deepseek-ai')).toBe('dsh-evolution-host')
})

async function runInstaller(home: string, mode: string, profile = 'evo-test', extra: string[] = [], env: Record<string, string> = {}) {
  return run(process.execPath, [installer, '--mode', mode, '--profile', profile, '--home', home, ...extra], { env: { ...process.env, ...env } })
}

/**
 * Write one platform base preset patch fixture under an explicit preset root, in the form the
 * platform ships (`packages/bundle/web-app/presets/<base>.patch.yml`: one `- insert:` entry whose
 * row carries `config.plugins`).
 * @param rootDir - the directory `DSH_AGENT_PRESET_ROOT` names.
 * @param base - the base name (the file's stem).
 * @param rows - the plugin row lines, at column 0.
 */
async function writeBasePatch(rootDir: string, base: string, rows: string[]): Promise<void> {
  await mkdir(rootDir, { recursive: true })
  await writeFile(join(rootDir, `${base}.patch.yml`), [
    `# ${base} base patch fixture`,
    '- insert:',
    '    - id: preset-fixture',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: fixture',
    '        order: 1',
    '        plugins:',
    ...rows.map(row => '          ' + row),
    '',
  ].join('\n'))
}

/** PLAN S5.8 (2026-09-16, audit P2-26): the packages root the installer
 * resolves its staging against (`<pkg>/tests/../../` = the overlay root in the
 * dev tree and `packages/evolution/` in the mirror layout — the same
 * PACKAGES_DIR `install-layered.mjs` derives from its own URL). */
const stagingDir = fileURLToPath(new URL('../../.release-staging', import.meta.url))

/** The freshness baseline the installer compares the staging version against
 * (P2-22/V24-17: the FAMILY version from the family source tree). */
async function familyVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../../evolution-host/package.json', import.meta.url)), 'utf8')) as { version?: string }
  return manifest.version ?? ''
}

/** Run one scoped-install scenario against a MINIMAL `.release-staging` (the
 * agent mode reads only the freshness manifest and the delta from it, so the
 * real `packageSourceRoot()` code path is exercised without a full pack). Any
 * pre-existing staging is moved aside and restored, never destroyed. */
async function withStaging<T>(manifest: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const backup = `${stagingDir}.spec-backup`
  const hadStaging = existsSync(stagingDir)
  if (hadStaging) await rename(stagingDir, backup)
  await mkdir(join(stagingDir, 'evolution-agent'), { recursive: true })
  await writeFile(join(stagingDir, '.staging-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  // The delta lives INSIDE the staging on a real scoped install; keeping
  // DSH_EVOLUTION_DELTA_PATH unset is what puts packageSourceRoot() on the
  // code path the scope check guards.
  await writeFile(join(stagingDir, 'evolution-agent', 'agent.cordis.yml'), '- id: tool-memory\n  name: "@deepseek-ai/dsh-memory/tools"\n')
  try {
    return await fn()
  } finally {
    await rm(stagingDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    if (hadStaging) await rename(backup, stagingDir)
  }
}

describe('layered installer', () => {
  it('installs the host bundle into a clean DSH_HOME', async () => {
    const home = await tempRoot('dsh-installer-')
    const { stdout } = await runInstaller(home, 'host')
    const profileDir = join(home, 'profiles', 'evo-test')
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).toContain('@deepseek-ai/dsh-evolution-host')

    // Source installs without built lib/index.js must say so instead of
    // silently producing a profile that cannot boot; a built tree just boots.
    const builtMarker = fileURLToPath(new URL('../../evolution-core/lib/index.js', import.meta.url))
    if (existsSync(builtMarker)) expect(stdout).not.toContain('unbuilt:')
    else expect(stdout).toContain('unbuilt:')
    const sourceTypes = fileURLToPath(new URL('../../evolution-core/lib/types/state/storage.d.ts', import.meta.url))
    if (existsSync(sourceTypes)) {
      await expect(readFile(
        join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-core/lib/types/state/storage.d.ts'),
        'utf8',
      )).resolves.toContain('evolution-core/state/storage')
    }

    const patchRows = insertedRows(loadOverlayPatches('test', join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-host/cordis.patch.yml')))
    expect(rowIds(patchRows)).toContain('evolution-review')
  }, 60_000)

  it('refuses the removed one-click install but keeps the uninstall hint', async () => {
    const home = await tempRoot('dsh-installer-oneclick-')
    await expect(runInstaller(home, 'oneclick', 'web')).rejects.toThrow(/removed in 0\.48.*--uninstall/)
    await expect(readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')).rejects.toThrow()
  }, 60_000)

  it('uninstalls a legacy layered profile without touching user data', async () => {
    const home = await tempRoot('dsh-installer-uninstall-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-host'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-evolution-host'] } } }), 'utf8')
    await runInstaller(home, 'layered', 'evo-test', ['--uninstall'])
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    // The platform base row survives an evolution uninstall — uninstall removes
    // evolution bundles, not the profile's platform foundation.
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
  }, 60_000)

  it('uninstalls a legacy one-click profile without touching user data', async () => {
    const home = await tempRoot('dsh-installer-uninstall-oneclick-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-preset'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-evolution-preset'] } } }), 'utf8')
    await runInstaller(home, 'oneclick', 'evo-test', ['--uninstall'])
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
  }, 60_000)

  it('uninstalls a legacy preset row from the profile patch', async () => {
    const home = await tempRoot('dsh-installer-uninstall-row-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-host'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-evolution-host'] } } }), 'utf8')
    await writeFile(join(profileDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: preset-evolution',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: evolution',
      '        plugins:',
      '          - id: tool-memory',
      '',
    ].join('\n'), 'utf8')
    await runInstaller(home, 'layered', 'evo-test', ['--uninstall'])
    const patch = await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain('preset-evolution')
    expect(patch).not.toContain('dsh-agent-preset')
  }, 60_000)

  it('does not write profile files in dry-run mode', async () => {
    const dryHome = await tempRoot('dsh-installer-dry2-')
    const { stdout } = await runInstaller(dryHome, 'all', 'evo-test', ['--dry-run'])
    expect(stdout).toContain('dry-run:  no files were written')
    await expect(readFile(join(dryHome, 'profiles', 'evo-test', 'package.json'), 'utf8')).rejects.toThrow()
  }, 60_000)

  
  
  
  
  
  
  
  
  
  
  
  
  
  it('P1-3: --mode all refuses when the profile already carries the one-click preset bundle', async () => {
    const home = await tempRoot('dsh-installer-all-preset-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-preset'] } } }), 'utf8')
    await expect(runInstaller(home, 'all', 'evo-test')).rejects.toThrow(/mutually exclusive/)
  }, 30_000)

  it('P1-3: --mode host refuses an evolution-all profile; --mode oneclick is removed', async () => {
    const home = await tempRoot('dsh-installer-p13-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-all'] } } }), 'utf8')
    await expect(runInstaller(home, 'host')).rejects.toThrow(/evolution-all/)
    await expect(runInstaller(home, 'oneclick')).rejects.toThrow(/removed in 0\.48/)
  }, 30_000)

  it('N10 (v12): --dry-run host refuses too — dry-run reads the real profile state', async () => {
    const home = await tempRoot('dsh-installer-n10-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-all'] } } }), 'utf8')
    // The dry-run gate used to skip the mutual-exclusion check (and documented
    // a phantom-path rationale that contradicted the code): a dry-run reported
    // the host bundle as installable on an all profile.
    await expect(runInstaller(home, 'host', 'evo-test', ['--dry-run'])).rejects.toThrow(/evolution-all/)
  }, 30_000)

  it('P2-2 (v13): --dry-run host refuses a profile carrying the oneclick/preset bundle (E-33)', async () => {
    const home = await tempRoot('dsh-installer-p22a-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-preset'] } } }), 'utf8')
    // N10 killed the dry-run loophole for evolution-all only; the E-33
    // host⇄preset check stayed behind the dry-run gate and reported
    // "installable" (wet-run refused). Dry-run must match the real mode.
    await expect(runInstaller(home, 'host', 'evo-test', ['--dry-run'])).rejects.toThrow(/mutually exclusive/)
  }, 30_000)

  it('P2-2 (v13): --dry-run oneclick is refused because oneclick installation is removed', async () => {
    const home = await tempRoot('dsh-installer-p22b-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-host'] } } }), 'utf8')
    await expect(runInstaller(home, 'oneclick', 'evo-test', ['--dry-run'])).rejects.toThrow(/removed in 0\.48/)
  }, 30_000)

  it('P1-2: --uninstall removes the evolution-all bundle row too (symmetric with host/preset)', async () => {
    const home = await tempRoot('dsh-installer-p12-')
    const profileDir = join(home, 'profiles', 'evo-test')
    const manifestPath = join(profileDir, 'package.json')
    await mkdir(profileDir, { recursive: true })
    await writeFile(manifestPath, JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-all'] } } }), 'utf8')
    const { stdout } = await runInstaller(home, 'layered', 'evo-test', ['--uninstall'])
    const after = JSON.parse(await readFile(manifestPath, 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    // N11 (v12): the manifest carries NO host/oneclick row, so the report must
    // not print a phantom `bundle:` line claiming it removed one.
    expect(stdout).not.toContain('bundle:')
    expect(after.dsh?.profile?.bundles ?? []).not.toContain('@lmzhen/dsh-evolution-all')
  }, 30_000)

  it('P2-42 + N11: a dry-run uninstall reports preset: false and no phantom bundle line', async () => {
    const home = await tempRoot('dsh-installer-p242-')
    const { stdout } = await runInstaller(home, 'layered', 'evo-test', ['--uninstall', '--dry-run'])
    // The old assertion `not.toContain('removedAgentPreset')` was vacuous — the
    // CLI prints `preset:   <bool>`; assert the TRUE value (and that no
    // removed-bundle claim sneaks in either).
    expect(stdout).toMatch(/preset:\s+false/)
    expect(stdout).not.toContain('bundle:')
  }, 30_000)

  
  it('D-1 (v18): --mode oneclick is refused before reading the profile patch', async () => {
    const home = await tempRoot('dsh-installer-d1b-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }), 'utf8')
    await expect(runInstaller(home, 'oneclick', 'evo-test', ['--dry-run'])).rejects.toThrow(/removed in 0\.48/)
  }, 30_000)

    it('D-3/D-4 (v18): a fresh profile is seeded with the platform bundles and the mounted bundle is pinned', async () => {
    const home = await tempRoot('dsh-installer-d34-')
    // D-4 parity: a name WITH a shipped template seeds that template
    // (`PROFILE_TEMPLATES.web = base + web-app`), matching upstream initProfile.
    await runInstaller(home, 'host', 'web')
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-evolution-host',
    ])
    // D-3: the mounted bundle is pinned in dependencies, not only in bundles.
    // The single-bundle update contract requires an EXACT family version here:
    // a range would let a platform update keep older implementation packages.
    expect(manifest.dependencies?.['@deepseek-ai/dsh-evolution-host']).toBe(await familyVersion())
  }, 60_000)

  it('D-4 (v18): a profile name with no shipped template seeds DEFAULT_PROFILE_BUNDLES', async () => {
    const home = await tempRoot('dsh-installer-d4default-')
    // Upstream DEFAULT_PROFILE_BUNDLES is `['@deepseek-ai/dsh-base']`
    // (app-boot/src/profile.ts:124); the custom name must not inherit the web
    // template's web-app row.
    await runInstaller(home, 'host', 'evo-test')
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'evo-test', 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-evolution-host'])
  }, 60_000)

  
  it('G2.2 (v33): a self-created profile carries the platform template bundles', async () => {
    // The installer creates a profile before `dsh` ever touches it, so it seeds
    // the platform's `PROFILE_TEMPLATES[name]` by hand: five names whose bundle
    // lists decide which rows a self-created `sdk-minimal` profile mounts
    // (D-4's original defect, one generation later). The seeded manifest holds
    // `dsh.profile.bundles` alone, like the platform's `initProfile`; the 0.1.5
    // line's extra `patchReload` field is gone on 0.2.x, where the user patch
    // layer hot-reloads on long-lived surfaces without a per-profile switch.
    const home = await tempRoot('dsh-installer-seed-')
    await runInstaller(home, 'host', 'sdk-minimal')
    const minimal = JSON.parse(await readFile(join(home, 'profiles', 'sdk-minimal', 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    // sdk-minimal's template is the single sdk package — no base row. The row
    // the install itself mounts is appended after the seeded template.
    expect(minimal.dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-sdk-minimal',
      '@deepseek-ai/dsh-evolution-host',
    ])
    expect(Object.keys(minimal.dsh?.profile ?? {})).toEqual(['bundles'])

    await runInstaller(home, 'host', 'web')
    const web = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(web.dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-evolution-host',
    ])
    expect(Object.keys(web.dsh?.profile ?? {})).toEqual(['bundles'])
  }, 60_000)

  // v33 REG-02 / v31 INST-01/02/05 / v18 D-11: the five `packages/scripts/*.mjs`
  // fixes that live in the release tooling. The installer exports no test seam
  // for its internal write/copy helpers, so (a) runs through the CLI (the real
  // code path); (b) and (c) spawn the real scripts and read their refusal —
  // the guards run at module scope, BEFORE any staging read or pack, which is
  // exactly why they can be pinned without a release tree; (d) is the
  // source-level pin described at its assertion.
  it('REG-02: the install journal is written atomically', async () => {
    const seeded = await tempRoot('dsh-installer-reg02b-')
    await runInstaller(seeded, 'host', 'evo-reg02')
    const journalPath = join(seeded, 'profiles', 'evo-reg02', '.evolution-install.json')
    expect(existsSync(journalPath)).toBe(true)
    expect(JSON.parse(await readFile(journalPath, 'utf8'))).toMatchObject({ scope: '@deepseek-ai' })
    // INST-01: the write is tmp+rename, so the staging name is never left
    // behind next to the committed file.
    const leftovers = (await (await import('node:fs/promises')).readdir(join(seeded, 'profiles', 'evo-reg02')))
      .filter(name => name.startsWith('.evolution-install.json') && name !== '.evolution-install.json')
    expect(leftovers).toEqual([])
  }, 60_000)

  
  it('INST-05: --scope --version 0.1.0 does not bind --version as the scope value', async () => {
    // The guard runs at module scope, BEFORE any pack/staging work, so this
    // spawns the real script and reads its refusal instead of producing a
    // release tree. Before INST-05 the fallback bound the string '--version'
    // as the scope and the run failed much later, far from the cause.
    const script = fileURLToPath(new URL('../../scripts/prepare-release.mjs', import.meta.url))
    const error = await run(process.execPath, [script, '--scope', '--version', '0.1.0'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain('missing required --scope')
    expect(error?.stderr).not.toContain('--version')
  }, 20_000)

  it('P2-38: npm files globs match ** as zero-or-more directories', async () => {
    const helper = new URL('../../scripts/files-glob.mjs', import.meta.url).href
    const body = [
      `import { coveredByFiles } from ${JSON.stringify(helper)}`,
      "const cases = [" ,
      "  [['lib/**/*.js'], 'lib/index.js', true],",
      "  [['lib/**/*.js'], 'lib/a/b.js', true],",
      "  [['lib/*.js'], 'lib/a/b.js', false],",
      "  [['lib/types/**/*.d.ts'], 'lib/types/index.d.ts', true],",
      "  [['lib'], 'lib/index.js', true],",
      "  [['**/*.js'], 'index.js', true],",
      "  [['lib/**/index.js'], 'lib/index.js', true],",
      "  [['lib/**/index.js'], 'lib/a/index.js', true],",
      "]",
      'process.stdout.write(JSON.stringify(cases.map(([files, rel]) => coveredByFiles(files, rel))))',
    ].join('\n')
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', body])
    expect(JSON.parse(stdout)).toEqual([true, true, false, true, true, true, true, true])
  }, 20_000)

  it('P2-35: only a definite npm E404 is an absent package/version', async () => {
    const helper = new URL('../../scripts/npm-view.mjs', import.meta.url).href
    const body = [
      `import { viewOutcome, isAbsentViewError } from ${JSON.stringify(helper)}`,
      "const fail = text => () => { const error = new Error('command failed'); error.stderr = text; throw error }",
      "const value = [viewOutcome(() => 'sha512-x').kind, viewOutcome(fail('npm ERR! code E404')).kind, viewOutcome(fail('npm ERR! code ETIMEDOUT')).kind, isAbsentViewError({ message: '404 Not Found' }), isAbsentViewError({ message: 'E401 Unauthorized' })]",
      'process.stdout.write(JSON.stringify(value))',
    ].join('\n')
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', body])
    expect(JSON.parse(stdout)).toEqual(['present', 'absent', 'error', true, false])
  }, 20_000)

  it('INST-05: a bare --otp hands npm no OTP value (the next flag is not one)', async () => {
    // Same shape as above: the guard throws before dist/manifest.json is read,
    // so no release tree is needed. Before INST-05 `--otp --dry-run` handed
    // '--dry-run' to npm as the one-time password.
    const script = fileURLToPath(new URL('../../scripts/publish-scoped.mjs', import.meta.url))
    const error = await run(process.execPath, [script, '--tag', 'next', '--otp', '--dry-run'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain('--otp requires a value')
  }, 20_000)

  it('P2-37: copyPackage swaps through a recoverable previous tree and clears other-pid residue', async () => {
    const home = await tempRoot('dsh-copy-swap-')
    const source = join(home, 'source')
    const destination = join(home, 'pkg')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'new' }))
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'package.json'), JSON.stringify({ name: 'old' }))
    await mkdir(destination + '.staging-999999', { recursive: true })
    await mkdir(destination + '.previous-999999', { recursive: true })
    await callInstaller(`await installer.copyPackage(${JSON.stringify(source)}, ${JSON.stringify(destination)}); return 1`)
    expect(JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')).name).toBe('new')
    expect(existsSync(destination + '.staging-999999')).toBe(false)
    expect(existsSync(destination + '.previous-999999')).toBe(false)
    // Crash state: the old tree was moved aside and the destination is missing.
    await rm(destination, { recursive: true, force: true })
    await mkdir(destination + '.previous-777777', { recursive: true })
    await writeFile(join(destination + '.previous-777777', 'package.json'), JSON.stringify({ name: 'rescued' }))
    await callInstaller(`await installer.copyPackage(${JSON.stringify(source)}, ${JSON.stringify(destination)}); return 1`)
    expect(JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')).name).toBe('new')
    expect(existsSync(destination + '.previous-777777')).toBe(false)
  }, 30_000)

  it('INST-02 + D-11: copyPackage skips release tarballs; a bare --groups is refused', async () => {
    // `copyPackage` is module-private and the installer exports no seam for it
    // (its only caller is the staged-copy sweep, which needs a full
    // .release-staging tree). Pin the filter's invariant on the source instead
    // of asserting nothing: the `.tgz` exclusion must sit in the SAME filter
    // expression as the node_modules/tests exclusions, or a release staging
    // copies each package's own `npm pack` tarball into the user profile
    // (v31 INST-02: doubled on-disk size per package).
    const installerSource = await readFile(fileURLToPath(new URL('../../scripts/install-layered.mjs', import.meta.url)), 'utf8')
    const filter = /filter\(sourcePath\) \{[\s\S]*?\n {6}\}/.exec(installerSource)?.[0]
    expect(filter).toBeDefined()
    expect(filter).toContain("base !== 'node_modules'")
    expect(filter).toContain('base.endsWith(\'.tgz\')')
    expect(filter).not.toContain('base.endsWith(\'.tsbuildinfo\') &&')
    // D-11 (v18): the --groups guard is at module scope, so the real script
    // refuses a bare flag before reading dist/.
    const script = fileURLToPath(new URL('../../scripts/publish-scoped.mjs', import.meta.url))
    const error = await run(process.execPath, [script, '--groups', '--dry-run'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain('--groups requires a positive integer')
  }, 20_000)

  it('P1-3 (v19): uninstall removes the D-3 dependency row together with the bundle row', async () => {
    const home = await tempRoot('dsh-installer-dep-')
    await runInstaller(home, 'host', 'evo-test')
    const manifestPath = join(home, 'profiles', 'evo-test', 'package.json')
    const before = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(before.dependencies?.['@deepseek-ai/dsh-evolution-host']).toBe(await familyVersion())
    expect(before.dsh?.profile?.bundles).toContain('@deepseek-ai/dsh-evolution-host')
    // P1-3: the journal records what the installer wrote.
    const journalPath = join(home, 'profiles', 'evo-test', '.evolution-install.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { bundle?: string; dependencyAdded?: boolean }
    expect(journal.bundle).toBe('@deepseek-ai/dsh-evolution-host')
    expect(journal.dependencyAdded).toBe(true)
    await runInstaller(home, 'host', 'evo-test', ['--uninstall'])
    const after = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    // The residue that used to make the next pnpm materialization fail E404.
    expect(after.dependencies?.['@deepseek-ai/dsh-evolution-host']).toBeUndefined()
    expect(after.dsh?.profile?.bundles ?? []).not.toContain('@deepseek-ai/dsh-evolution-host')
    expect(existsSync(journalPath)).toBe(false)
  }, 60_000)

  it('repair dry-run plans a single-bundle profile without writing', async () => {
    const home = await tempRoot('dsh-installer-repair-')
    const profileDir = join(home, 'profiles', 'evo-test')
    const allDir = join(profileDir, 'node_modules/@lmzhen/dsh-evolution-all')
    await mkdir(allDir, { recursive: true })
    await writeFile(join(allDir, 'package.json'), JSON.stringify({
      name: '@lmzhen/dsh-evolution-all',
      version: '0.53.0',
      dependencies: {
        '@lmzhen/dsh-evolution-core': '0.53.0',
        '@lmzhen/dsh-evolution-ui': '0.53.0',
      },
    }))
    const manifestPath = join(profileDir, 'package.json')
    const original = JSON.stringify({
      name: 'dsh-profile-evo-test',
      private: true,
      dependencies: {
        '@lmzhen/dsh-evolution-all': '0.53.0',
        '@lmzhen/dsh-evolution-core': '0.51.1',
        '@lmzhen/dsh-evolution-ui': '0.51.1',
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@lmzhen/dsh-evolution-all'] } },
    }, null, 2) + '\n'
    await writeFile(manifestPath, original)
    const result = await callInstaller(`return await installer.repairProfile({
      home: ${JSON.stringify(home)}, profile: 'evo-test', dryRun: true, version: '0.53.0',
    })`) as { familyDirect?: string[]; targetVersion?: string; changed?: boolean }
    expect(result.changed).toBe(false)
    expect(result.targetVersion).toBe('0.53.0')
    expect(result.familyDirect?.sort()).toEqual([
      '@lmzhen/dsh-evolution-core',
      '@lmzhen/dsh-evolution-ui',
    ])
    expect(await readFile(manifestPath, 'utf8')).toBe(original)
  }, 30_000)

  it('repair refuses a profile without an evolution-all bundle', async () => {
    const home = await tempRoot('dsh-installer-repair-none-')
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh-evolution-host': '0.53.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-evolution-host'] } },
    }))
    await expect(callInstaller(`return await installer.repairProfile({
      home: ${JSON.stringify(home)}, profile: 'evo-test', dryRun: true, version: '0.53.0',
    })`)).rejects.toThrow(/does not mount an evolution-all bundle/)
  }, 30_000)

  it('repair succeeds through pnpm and validates the transitive family closure', async () => {
    const home = await tempRoot('dsh-installer-repair-success-')
    const profileDir = join(home, 'profiles', 'evo-test')
    const allDir = join(profileDir, 'node_modules/@lmzhen/dsh-evolution-all')
    await mkdir(allDir, { recursive: true })
    await writeFile(join(allDir, 'package.json'), JSON.stringify({
      name: '@lmzhen/dsh-evolution-all',
      version: '0.53.0',
      dependencies: {
        '@lmzhen/dsh-evolution-core': '0.53.0',
        '@lmzhen/dsh-evolution-ui': '0.53.0',
      },
    }))
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-evo-test',
      private: true,
      dependencies: {
        '@lmzhen/dsh-evolution-all': '0.53.0',
        '@lmzhen/dsh-evolution-ui': '0.51.1',
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@lmzhen/dsh-evolution-all'] } },
    }, null, 2) + '\n')
    const fakePnpm = join(home, 'fake-pnpm.mjs')
    await writeFile(fakePnpm, [
      "import { mkdir, readFile, writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      "const root = process.cwd()",
      "const target = '0.53.0'",
      "const packages = {",
      "  '@lmzhen/dsh-evolution-all': { '@lmzhen/dsh-evolution-core': target, '@lmzhen/dsh-evolution-ui': target },",
      "  '@lmzhen/dsh-evolution-core': {},",
      "  '@lmzhen/dsh-evolution-ui': { '@lmzhen/dsh-evolution-client-kit': target },",
      "  '@lmzhen/dsh-evolution-client-kit': {},",
      "}",
      "for (const [name, deps] of Object.entries(packages)) {",
      "  const dir = join(root, 'node_modules', name)",
      "  await mkdir(dir, { recursive: true })",
      "  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: target, dependencies: deps }))",
      "}",
      "await readFile(join(root, 'package.json'), 'utf8')",
    ].join('\n'))
    const result = await callInstaller(`return await installer.repairProfile({
      home: ${JSON.stringify(home)}, profile: 'evo-test', version: '0.53.0',
      pnpm: ${JSON.stringify(fakePnpm)},
    })`) as { installed?: boolean; familyDirect?: string[]; cleanupError?: string }
    expect(result.installed).toBe(true)
    expect(result.cleanupError).toBeUndefined()
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@lmzhen/dsh-evolution-all'])
    expect(manifest.dsh?.profile?.bundles).toContain('@lmzhen/dsh-evolution-all')
    const journal = JSON.parse(await readFile(join(profileDir, '.evolution-install.json'), 'utf8')) as { mode?: string; version?: number }
    expect(journal.mode).toBe('pnpm-bundle')
    expect(journal.version).toBe(2)
    for (const name of [
      '@lmzhen/dsh-evolution-all',
      '@lmzhen/dsh-evolution-core',
      '@lmzhen/dsh-evolution-ui',
      '@lmzhen/dsh-evolution-client-kit',
    ]) {
      expect(JSON.parse(await readFile(join(profileDir, 'node_modules', name, 'package.json'), 'utf8')).version).toBe('0.53.0')
    }
    const leftovers = (await readdir(profileDir)).filter(name => name.startsWith('.evolution-repair-backup-'))
    expect(leftovers).toEqual([])
  }, 30_000)

  it('repair removes a lock written by a failed pnpm run when none existed', async () => {
    const home = await tempRoot('dsh-installer-repair-lock-')
    const profileDir = join(home, 'profiles', 'evo-test')
    const allDir = join(profileDir, 'node_modules/@lmzhen/dsh-evolution-all')
    await mkdir(allDir, { recursive: true })
    await writeFile(join(allDir, 'package.json'), JSON.stringify({
      name: '@lmzhen/dsh-evolution-all',
      version: '0.53.0',
      dependencies: {},
    }))
    const manifestPath = join(profileDir, 'package.json')
    const original = JSON.stringify({
      name: 'dsh-profile-evo-test',
      private: true,
      dependencies: { '@lmzhen/dsh-evolution-all': '0.53.0' },
      dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-all'] } },
    }, null, 2) + '\n'
    await writeFile(manifestPath, original)
    const fakePnpm = join(home, 'fake-pnpm-lock.mjs')
    await writeFile(fakePnpm, [
      "import { writeFile } from 'node:fs/promises'",
      "await writeFile(process.cwd() + '/pnpm-lock.yaml', 'lockfileVersion: 9.0\\n')",
      'process.exit(1)',
    ].join('\n'))
    await expect(callInstaller(`return await installer.repairProfile({
      home: ${JSON.stringify(home)}, profile: 'evo-test', version: '0.53.0',
      pnpm: ${JSON.stringify(fakePnpm)},
    })`)).rejects.toThrow()
    expect(await readFile(manifestPath, 'utf8')).toBe(original)
    expect(existsSync(join(profileDir, 'pnpm-lock.yaml'))).toBe(false)
  }, 30_000)

  it('repair restores the manifest and node_modules when pnpm fails', async () => {
    const home = await tempRoot('dsh-installer-repair-fail-')
    const profileDir = join(home, 'profiles', 'evo-test')
    const allDir = join(profileDir, 'node_modules/@lmzhen/dsh-evolution-all')
    await mkdir(allDir, { recursive: true })
    await writeFile(join(allDir, 'package.json'), JSON.stringify({
      name: '@lmzhen/dsh-evolution-all',
      version: '0.53.0',
      dependencies: {},
    }))
    await mkdir(join(profileDir, 'node_modules/@lmzhen/dsh-evolution-ui'), { recursive: true })
    await writeFile(join(profileDir, 'node_modules/@lmzhen/dsh-evolution-ui/marker'), 'old')
    const manifestPath = join(profileDir, 'package.json')
    const original = JSON.stringify({
      name: 'dsh-profile-evo-test',
      private: true,
      dependencies: {
        '@lmzhen/dsh-evolution-all': '0.53.0',
        '@lmzhen/dsh-evolution-ui': '0.51.1',
      },
      dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-all'] } },
    }, null, 2) + '\n'
    await writeFile(manifestPath, original)
    await expect(callInstaller(`return await installer.repairProfile({
      home: ${JSON.stringify(home)}, profile: 'evo-test', version: '0.53.0',
      pnpm: 'definitely-not-a-real-pnpm-command',
    })`)).rejects.toThrow()
    expect(await readFile(manifestPath, 'utf8')).toBe(original)
    expect(existsSync(join(profileDir, '.evolution-install.json'))).toBe(false)
    expect(await readFile(join(profileDir, 'node_modules/@lmzhen/dsh-evolution-ui/marker'), 'utf8')).toBe('old')
  }, 30_000)

})

void writeBasePatch
void familyVersion
void withStaging

