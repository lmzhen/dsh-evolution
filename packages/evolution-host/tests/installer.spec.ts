import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { cordisRows, insertedRows, rowId, rowIds } from '../../test-support/cordis-rows.ts'

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

    // V10-14 (P1-2): the 60-char catalog cap must be INJECTED onto the
    // standard-sourced `tool-skill` row — the session-visible instance mounts
    // in the preset scope, which no profile patch can reach. Exact-row match
    // (`tool-skill`, not the delta's `tool-skill-manage`).
    const capStart = composition.search(/^- id: tool-skill$/m)
    expect(capStart).toBeGreaterThanOrEqual(0)
    const rowEnd = composition.indexOf('\n- id:', capStart)
    const toolSkillBlock = composition.slice(capStart, rowEnd === -1 ? undefined : rowEnd)
    expect(toolSkillBlock).toContain('catalogDescriptionMaxLength: 60')
    expect(toolSkillBlock).toContain('V10-14')

    const patchRows = insertedRows(loadOverlayPatches('test', join(profileDir, 'node_modules/@deepseek-ai/dsh-evolution-host/cordis.patch.yml')))
    expect(rowIds(patchRows)).toContain('evolution-review')

    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 60_000)

  it('installs the compatibility one-click bundle', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-oneclick-'))
    await runInstaller(home, 'oneclick', 'web')
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).toContain('@deepseek-ai/dsh-evolution-preset')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 60_000)

  it('uninstalls the layered installation without touching user data', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-uninstall-'))
    await runInstaller(home, 'layered')
    await runInstaller(home, 'layered', 'evo-test', ['--uninstall'])
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'evo-test', 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    // D-4 (v18): the installer-created profile is seeded from the platform
    // template (`DEFAULT_PROFILE_BUNDLES` for a name with no template), so the
    // platform base row survives an evolution uninstall — uninstall removes
    // evolution bundles, not the profile's platform foundation.
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(join(home, 'profiles', 'evo-test', 'node_modules/@deepseek-ai'))).toHaveLength(0)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 60_000)

  it('does not write profile files in dry-run mode', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-dry-'))
    await runInstaller(home, 'layered')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    const dryHome = await mkdtemp(join(tmpdir(), 'dsh-installer-dry2-'))
    const { stdout } = await runInstaller(dryHome, 'layered', 'evo-test', ['--dry-run'])
    expect(stdout).toContain('dry-run:  no files were written')
    await expect(readFile(join(dryHome, 'profiles', 'evo-test', 'package.json'), 'utf8')).rejects.toThrow()
    await rm(dryHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 60_000)

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
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 20_000)

  it('mounts the 60-char catalog cap as a top-level tool-skill override (mount-and-restore semantics)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-hostpatch-'))
    await runInstaller(home, 'layered')
    const profileDir = join(home, 'profiles', 'evo-test')
    const overlay = loadOverlayPatches('test', join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-evolution-host', 'cordis.patch.yml'))
    const topLevel = cordisRows(overlay)
    const override = topLevel.find(row => rowId(row) === 'tool-skill')
    expect(override).toBeDefined()
    expect(override?.config).toMatchObject({ catalogDescriptionMaxLength: 60 })
    // It overrides the BASE row in place — never an inserted duplicate that
    // would mount the tool twice. A profile overlay (later patch) may replace
    // the value; removing the host bundle removes the injection entirely.
    expect(insertedRows(overlay).some(row => rowId(row) === 'tool-skill')).toBe(false)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    // v18: this case spawns the real installer twice (layered + oneclick) and
    // needs the same budget as its siblings — 20s flaked under full-suite load.
  }, 60_000)

  it('V10-14: cap injection is idempotent and warns when the standard row is absent', async () => {
    // The installer script ships no type declarations, so the function runs in
    // a fresh node subprocess (base64 stdout, no lint-visible any) — the same
    // pattern as the byte-parity pin below.
    const cases = {
      plain: "- id: persona\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n",
      configured: "- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n  config:\n    custom: 1\n",
      absent: '- id: persona\n  name: x\n',
    }
    const script = [
      `import { injectToolSkillCap } from ${JSON.stringify(new URL('../../scripts/install-layered.mjs', import.meta.url).href)}`,
      `const cases = ${JSON.stringify(cases)}`,
      'const warns = []',
      'const originalWarn = console.warn',
      'console.warn = (message) => warns.push(String(message))',
      'const out = Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, injectToolSkillCap(value)]))',
      'console.warn = originalWarn',
      'process.stdout.write(Buffer.from(JSON.stringify({ out, warns }), "utf8").toString("base64"))',
    ].join('\n')
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script])
    const { out, warns } = JSON.parse(Buffer.from(stdout, 'base64').toString('utf8')) as { out: Record<string, string>; warns: string[] }
    // A plain standard row gains the config block plus the marker comment.
    expect(out.plain).toContain('config:')
    expect(out.plain).toContain('catalogDescriptionMaxLength: 60')
    expect(out.plain).toContain('V10-14')
    // Idempotent: an already-configured row is left byte-identical (no doubled
    // config key on a re-install).
    expect(out.configured).toBe(cases.configured)
    // No tool-skill row: composition unchanged, but the missed cap is loud.
    expect(out.absent).toBe(cases.absent)
    expect(warns.join('\n')).toContain('tool-skill')
  }, 20_000)

  it('core composePresetComposition and installer generateAgentPreset agree byte-for-byte (0.3.15 single-source pin)', async () => {
    const { composePresetComposition } = await import('@deepseek-ai/dsh-evolution-core')
    // 0.3.53: the fixture carries a standard-sourced tool-skill row so the
    // parity pin also covers the V10-14 cap injection — a one-sided composer
    // forgetting the injection would fail HERE, not in the power/idempotent
    // cases that feed it a hand-crafted row.
    const standard = '# runtime standard\n- id: persona\n  name: "@deepseek-ai/dsh-persona"\n\n- id: tools\n  name: "@deepseek-ai/dsh-tools"\n\n- id: tool-skill\n  name: "@deepseek-ai/dsh-tool-skill"\n\n'
    const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n\n'
    // The installer script ships no type declarations, so the parity check
    // runs it in a fresh node subprocess (base64 stdout, no lint-visible any).
    const script = [
      `import { generateAgentPreset } from ${JSON.stringify(new URL('../../scripts/install-layered.mjs', import.meta.url).href)}`,
      `const out = generateAgentPreset(${JSON.stringify(standard)}, ${JSON.stringify(delta)})`,
      'process.stdout.write(Buffer.from(out, "utf8").toString("base64"))',
    ].join('\n')
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script])
    const installed = Buffer.from(stdout, 'base64').toString('utf8')
    const composed = composePresetComposition(standard, delta)
    expect(installed).toBe(composed)
    // The shared fixture row must actually exercise the injection on both sides.
    expect(composed).toContain('catalogDescriptionMaxLength: 60')
  })

  it('core composePresetComposition honors the DSH_EVOLUTION_ALLOW_ROW_COLLISIONS escape (0.3.25 collision-path pin)', async () => {
    const { composePresetComposition } = await import('@deepseek-ai/dsh-evolution-core')
    const standard = '- id: persona\n- id: tool-session-query\n'
    const delta = '- id: tool-memory\n- id: tool-session-query\n'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const previous = process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS
    process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS = '1'
    try {
      // Matches install-layered's generateAgentPreset escape: fail loud by
      // default (pinned above), keep both + warn when the env says so.
      expect(composePresetComposition(standard, delta)).toContain('- id: tool-session-query')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('collide with standard rows'))
    } finally {
      warn.mockRestore()
      if (previous === undefined) delete process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS
      else process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS = previous
    }
  })

  it('V6-49: layered then oneclick on one profile fails loud (E-33 mutual exclusion, 0.3.37)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-v649-'))
    await runInstaller(home, 'layered')
    // The oneclick bundle is the preset package — host ⇄ preset cannot co-exist
    // in one profile (shared rows would double-mount); the installer used to
    // turn the documented accident into reality. D-1 (v18) made the check fire
    // on the agent preset first, so the assertion pins BOTH the documented
    // E-33 wording and the D-1-specific reason.
    const failed = runInstaller(home, 'oneclick')
    await expect(failed).rejects.toThrow(/mutually exclusive install targets \(E-33\)/)
    await expect(failed).rejects.toThrow(/Evolution agent preset/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('V6-49: oneclick then layered fails loud (reverse order)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-v649b-'))
    await runInstaller(home, 'oneclick')
    // D-1 (v18): the reverse direction now refuses on the one-click bundle
    // before the host⇄preset check — same E-33 contract, specific reason.
    const failed = runInstaller(home, 'layered')
    await expect(failed).rejects.toThrow(/mutually exclusive install targets \(E-33\)/)
    await expect(failed).rejects.toThrow(/one-click preset bundle/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('V7-18: cross-scope bundle names still hit the E-33 mutual exclusion (0.3.44)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-v718-'))
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    // A profile carrying the host bundle under a NON-default scope — the
    // scoped install path needs .release-staging (not available in tests),
    // so the bundle entry is constructed directly; the mutual-exclusion
    // check runs BEFORE the package copy either way.
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-host'] } } }), 'utf8')
    await expect(runInstaller(home, 'oneclick')).rejects.toThrow(/mutually exclusive/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('0.3.54-T5: --mode agent refuses when the profile already carries evolution-all (choose-one guidance)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-routeb-'))
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-all'] } } }), 'utf8')
    await expect(runInstaller(home, 'agent')).rejects.toThrow(/evolution-all/)
    await expect(runInstaller(home, 'agent')).rejects.toThrow(/Choose ONE/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('P1-3: --mode host/oneclick refuses when the profile already carries evolution-all', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-p13-'))
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-all'] } } }), 'utf8')
    await expect(runInstaller(home, 'host')).rejects.toThrow(/evolution-all/)
    await expect(runInstaller(home, 'oneclick')).rejects.toThrow(/evolution-all/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('N10 (v12): --dry-run host refuses too — dry-run reads the real profile state', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-n10-'))
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-all'] } } }), 'utf8')
    // The dry-run gate used to skip the mutual-exclusion check (and documented
    // a phantom-path rationale that contradicted the code): a dry-run reported
    // the host bundle as installable on an all profile.
    await expect(runInstaller(home, 'host', 'evo-test', ['--dry-run'])).rejects.toThrow(/evolution-all/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('P2-2 (v13): --dry-run host refuses a profile carrying the oneclick/preset bundle (E-33)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-p22a-'))
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-preset'] } } }), 'utf8')
    // N10 killed the dry-run loophole for evolution-all only; the E-33
    // host⇄preset check stayed behind the dry-run gate and reported
    // "installable" (wet-run refused). Dry-run must match the real mode.
    await expect(runInstaller(home, 'host', 'evo-test', ['--dry-run'])).rejects.toThrow(/mutually exclusive/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('P2-2 (v13): --dry-run oneclick refuses a profile carrying the host bundle (E-33 reverse)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-p22b-'))
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@lmzhen/dsh-evolution-host'] } } }), 'utf8')
    await expect(runInstaller(home, 'oneclick', 'evo-test', ['--dry-run'])).rejects.toThrow(/mutually exclusive/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('P1-2: --uninstall removes the evolution-all bundle row too (symmetric with host/preset)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-p12-'))
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
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('P2-42 + N11: a dry-run uninstall reports preset: false and no phantom bundle line', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-p242-'))
    const { stdout } = await runInstaller(home, 'layered', 'evo-test', ['--uninstall', '--dry-run'])
    // The old assertion `not.toContain('removedAgentPreset')` was vacuous — the
    // CLI prints `preset:   <bool>`; assert the TRUE value (and that no
    // removed-bundle claim sneaks in either).
    expect(stdout).toMatch(/preset:\s+false/)
    expect(stdout).not.toContain('bundle:')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('D-1 (v18): --mode agent refuses a profile carrying the one-click preset bundle', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-d1a-'))
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-evolution-preset'] } } }), 'utf8')
    await expect(runInstaller(home, 'agent', 'evo-test', ['--dry-run'])).rejects.toThrow(/one-click preset bundle/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('D-1 (v18): --mode oneclick refuses when an Evolution agent preset exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-d1b-'))
    await mkdir(join(home, '.agent-presets', 'evolution'), { recursive: true })
    await expect(runInstaller(home, 'oneclick', 'evo-test', ['--dry-run'])).rejects.toThrow(/agent preset/)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('D-2 (v18): uninstalling host from a one-click profile keeps the packages (no phantom row)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-d2-'))
    const profileDir = join(home, 'profiles', 'evo-test')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-evolution-preset'] } } }), 'utf8')
    const { stdout } = await runInstaller(home, 'host', 'evo-test', ['--uninstall', '--dry-run'])
    expect(stdout).toMatch(/packages:\s+0/)
    expect(stdout).toContain('kept:')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('D-3/D-4 (v18): a fresh profile is seeded with the platform bundles and the mounted bundle is pinned', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-d34-'))
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
    // P2-22 (v19): the range must come from the FAMILY package — an overlay
    // checkout used to pin the host repo's root version (0.1.x) here, and the
    // loose /^\^0\.\d+\.\d+/ form accepted it.
    expect(manifest.dependencies?.['@deepseek-ai/dsh-evolution-host']).toMatch(/^\^0\.3\./)
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 60_000)

  it('D-4 (v18): a profile name with no shipped template seeds DEFAULT_PROFILE_BUNDLES', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-d4default-'))
    // Upstream DEFAULT_PROFILE_BUNDLES is `['@deepseek-ai/dsh-base']`
    // (app-boot/src/profile.ts:125); the custom name must not inherit the web
    // template's web-app row.
    await runInstaller(home, 'host', 'evo-test')
    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'evo-test', 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-evolution-host'])
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 60_000)

  // v33 REG-02 / v31 INST-01/02/05 / v18 D-11: the five `packages/scripts/*.mjs`
  // fixes that live in the release tooling. The installer exports no test seam
  // for its internal write/copy helpers, so (a) runs through the CLI (the real
  // code path); (b) and (c) spawn the real scripts and read their refusal —
  // the guards run at module scope, BEFORE any staging read or pack, which is
  // exactly why they can be pinned without a release tree; (d) is the
  // source-level pin described at its assertion.
  it('REG-02: the install journal is written into a not-yet-existing profile directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-reg02-'))
    // `--mode agent` never runs ensureProfile (v21 S-5) and the profile
    // directory does not exist. Before REG-02 the journal's tmp write hit
    // ENOENT on the missing parent and aborted the install AFTER the agent
    // preset was already on disk — a half-installed home.
    const { stdout } = await runInstaller(home, 'agent', 'evo-reg02', ['--dry-run'])
    expect(stdout).toContain('dry-run:  no files were written')
    // The real (non-dry-run) shape: build the profile dir by hand exactly as
    // an agent-mode install finds it, then run the layered mode whose journal
    // write is the one REG-02 covers.
    const seeded = await mkdtemp(join(tmpdir(), 'dsh-installer-reg02b-'))
    await runInstaller(seeded, 'host', 'evo-reg02')
    const journalPath = join(seeded, 'profiles', 'evo-reg02', '.evolution-install.json')
    expect(existsSync(journalPath)).toBe(true)
    expect(JSON.parse(await readFile(journalPath, 'utf8'))).toMatchObject({ scope: '@deepseek-ai' })
    // INST-01: the write is tmp+rename, so the staging name is never left
    // behind next to the committed file.
    const leftovers = (await (await import('node:fs/promises')).readdir(join(seeded, 'profiles', 'evo-reg02')))
      .filter(name => name.startsWith('.evolution-install.json') && name !== '.evolution-install.json')
    expect(leftovers).toEqual([])
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    await rm(seeded, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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

  it('INST-05: a bare --otp hands npm no OTP value (the next flag is not one)', async () => {
    // Same shape as above: the guard throws before dist/manifest.json is read,
    // so no release tree is needed. Before INST-05 `--otp --dry-run` handed
    // '--dry-run' to npm as the one-time password.
    const script = fileURLToPath(new URL('../../scripts/publish-scoped.mjs', import.meta.url))
    const error = await run(process.execPath, [script, '--tag', 'next', '--otp', '--dry-run'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain('--otp requires a value')
  }, 20_000)

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
    const home = await mkdtemp(join(tmpdir(), 'dsh-installer-dep-'))
    await runInstaller(home, 'host', 'evo-test')
    const manifestPath = join(home, 'profiles', 'evo-test', 'package.json')
    const before = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(before.dependencies?.['@deepseek-ai/dsh-evolution-host']).toMatch(/^\^0\.3\./)
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
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 60_000)

})
