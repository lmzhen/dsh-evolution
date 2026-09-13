import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { cordisRows, rowIds } from '../../test-support/cordis-rows.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

// Every case below spawns the installer (it ships no type declarations, so the
// exported helpers are evaluated in a fresh node process) — the family's
// established budget for spawn-heavy specs under full-suite parallel load.
vi.setConfig({ testTimeout: 60_000 })

const run = promisify(execFile)
const installer = fileURLToPath(new URL('../../scripts/install-layered.mjs', import.meta.url))
const installerUrl = new URL('../../scripts/install-layered.mjs', import.meta.url).href
const agentPackage = fileURLToPath(new URL('../../evolution-agent', import.meta.url))

/**
 * Evaluate a value inside a fresh node process that imported the installer,
 * and return it as JSON. The script ships no type declarations, so importing
 * it into this typed spec would need a local `any`; installer.spec uses the
 * same subprocess form for the same reason.
 * @param body - JavaScript statements ending in `return <value>`.
 * @returns the parsed JSON the subprocess printed.
 */
async function callInstaller(body: string): Promise<unknown> {
  const script = [
    `import * as installer from ${JSON.stringify(installerUrl)}`,
    `const value = (() => { ${body} })()`,
    'process.stdout.write(Buffer.from(JSON.stringify(value), "utf8").toString("base64"))',
  ].join('\n')
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script])
  return JSON.parse(Buffer.from(stdout, 'base64').toString('utf8'))
}

/** Ids of every top-level `- id:` row, in file order. */
function rowIdList(composition: string): string[] {
  const ids: string[] = []
  for (const line of composition.split('\n')) {
    const match = /^- id:\s*(\S+)\s*$/.exec(line)
    if (match?.[1] !== undefined) ids.push(match[1])
  }
  return ids
}

/** How many times each row id appears — the duplicate-row probe. */
function idCounts(composition: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const id of rowIdList(composition)) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

/**
 * The runtime agent-preset root, resolved the way the installer resolves it
 * (walk up until `packages/preset/agent-presets/presets` appears) so this spec
 * works from both family layouts.
 * @returns the absolute directory holding the shipped presets.
 */
function platformPresetRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'packages', 'preset', 'agent-presets', 'presets')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error('platform agent-preset root not found above the spec')
    dir = parent
  }
}

async function runInstaller(home: string, mode: string, extra: string[] = [], env: Record<string, string> = {}) {
  return run(process.execPath, [installer, '--mode', mode, '--profile', 'evo-base', '--home', home, ...extra], {
    env: { ...process.env, ...env },
  })
}

const STANDARD_FIXTURE = [
  '# runtime standard fixture',
  '- id: persona',
  '  name: "@deepseek-ai/dsh-persona"',
  '',
  '- id: tool-skill',
  '  name: "@deepseek-ai/dsh-tool-skill"',
  '',
].join('\n')

const DELTA_FIXTURE = [
  '# evolution delta fixture',
  '- id: tool-memory',
  '  name: "@deepseek-ai/dsh-tool-memory"',
  '',
  '- id: tool-session-query',
  '  name: "@deepseek-ai/dsh-tool-session-query"',
  '',
].join('\n')

const PTC_FIXTURE = [
  '# runtime ptc fixture',
  '- id: persona',
  '  name: "@deepseek-ai/dsh-persona"',
  '',
  '- id: tool-skill',
  '  name: "@deepseek-ai/dsh-tool-skill"',
  '',
  '- id: tool-presentation',
  '  name: "@deepseek-ai/dsh-agent-tool-presentation"',
  '  config:',
  '    mode: ptc',
  '',
  '- id: present',
  '  name: "@deepseek-ai/dsh-tool-present"',
  '',
].join('\n')

/**
 * The installed `standard`-base preset for the fixture pair above: captured
 * from the installer BEFORE the `--base` parameterization and frozen here. It
 * is the byte-identity pin for the default path — a change to the destination
 * directory, the composition source, the metadata source, or the V10-14 cap
 * injection moves these bytes.
 */
const DEFAULT_BASE_GOLDEN = [
  '# runtime standard fixture',
  '- id: persona',
  '  name: "@deepseek-ai/dsh-persona"',
  '',
  '- id: tool-skill',
  '  name: "@deepseek-ai/dsh-tool-skill"',
  '  # V10-14: Hermes 60-char catalog cap — injected by the preset composer (P1-2);',
  '  # this preset-scope row is the session-visible instance and no profile',
  '  # patch can reach it. Remove only to run the platform default (500).',
  '  config:',
  '    catalogDescriptionMaxLength: 60',
  '',
  '# evolution delta fixture',
  '- id: tool-memory',
  '  name: "@deepseek-ai/dsh-tool-memory"',
  '',
  '- id: tool-session-query',
  '  name: "@deepseek-ai/dsh-tool-session-query"',
  '',
].join('\n')

/** The four family delta rows every generated preset must carry. */
const FAMILY_DELTA_IDS = ['tool-memory', 'tool-skill-manage', 'tool-session-query', 'evolution-skill-catalog']

describe('agent preset bases (--base standard|ptc)', () => {
  it('keeps the default base byte-identical to the pre-parameterization output', async () => {
    const composed = await callInstaller(
      `return installer.generateAgentPreset(${JSON.stringify(STANDARD_FIXTURE)}, ${JSON.stringify(DELTA_FIXTURE)})`,
    )
    expect(composed).toBe(DEFAULT_BASE_GOLDEN)
    // One default, one table: the default base is a NAME resolved through
    // resolveAgentPresetBase, not a per-call-site fallback that could answer
    // differently at each site.
    const resolved = await callInstaller("return [installer.DEFAULT_AGENT_PRESET_BASE, installer.resolveAgentPresetBase().base, installer.resolveAgentPresetBase('standard').base]")
    expect(resolved).toEqual(['standard', 'standard', 'standard'])
    const directories = await callInstaller("return installer.agentPresetDirectories('H').map(entry => entry.base + ':' + entry.directory)")
    expect(directories).toEqual([
      `standard:${join('H', '.agent-presets', 'evolution')}`,
      `ptc:${join('H', '.agent-presets', 'evolution-ptc')}`,
    ])
  })

  it('installs the default base into .agent-presets/evolution, byte-for-byte', async () => {
    const home = await tempRoot('dsh-preset-base-default-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'standard'), { recursive: true })
    await writeFile(join(presetRoot, 'standard', 'agent.cordis.yml'), STANDARD_FIXTURE)
    // The frozen golden is the fixture PAIR, so the CLI wiring is pinned with
    // the same delta fixture the golden was captured with.
    const deltaPath = join(home, 'delta.fixture.yml')
    await writeFile(deltaPath, DELTA_FIXTURE)
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot, DSH_EVOLUTION_DELTA_PATH: deltaPath })
    expect(await readFile(join(home, '.agent-presets', 'evolution', 'agent.cordis.yml'), 'utf8')).toBe(DEFAULT_BASE_GOLDEN)
    // The standard base publishes the package's own metadata, unchanged.
    expect(await readFile(join(home, '.agent-presets', 'evolution', 'preset.yml'), 'utf8'))
      .toBe(await readFile(join(agentPackage, 'preset.yml'), 'utf8'))
    // A default install writes no variant directory.
    expect(existsSync(join(home, '.agent-presets', 'evolution-ptc'))).toBe(false)
  })

  it('composes the runtime ptc rows plus the family delta under --base ptc, vendoring nothing', async () => {
    const home = await tempRoot('dsh-preset-base-ptc-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'standard'), { recursive: true })
    await mkdir(join(presetRoot, 'ptc'), { recursive: true })
    await writeFile(join(presetRoot, 'standard', 'agent.cordis.yml'), STANDARD_FIXTURE)
    await writeFile(join(presetRoot, 'ptc', 'agent.cordis.yml'), PTC_FIXTURE)
    await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })

    const composition = await readFile(join(home, '.agent-presets', 'evolution-ptc', 'agent.cordis.yml'), 'utf8')
    // The delta is base-independent: the SHARED evolution-agent composition.
    const deltaIds = rowIdList(await readFile(join(agentPackage, 'agent.cordis.yml'), 'utf8'))
    expect(deltaIds).toEqual(FAMILY_DELTA_IDS)

    // 1. The platform ptc rows come first and VERBATIM, so the first line
    //    identifies which runtime composition was read.
    expect(composition.split('\n')[0]).toBe(PTC_FIXTURE.split('\n')[0])
    expect(composition.indexOf('- id: persona')).toBeLessThan(composition.indexOf('- id: tool-memory'))
    //    The rows that make the base PTC rather than standard.
    expect(composition).toContain('- id: tool-presentation')
    expect(composition).toContain('mode: ptc')
    expect(composition).toContain('- id: present')
    // 2. ...and the standard runtime composition was NOT the source.
    expect(composition).not.toContain(STANDARD_FIXTURE.split('\n')[0])
    // 3. Every family delta row is present exactly once.
    for (const id of FAMILY_DELTA_IDS) expect(idCounts(composition).get(id)).toBe(1)
    // 4. Nothing is vendored and nothing is duplicated: the generated row-id
    //    LIST is exactly the platform ids followed by the delta ids. A base
    //    that repeated a platform row, dropped one, or reordered the sources
    //    fails here.
    expect(rowIdList(composition)).toEqual([...rowIdList(PTC_FIXTURE), ...deltaIds])
    expect(rowIdList(PTC_FIXTURE).filter(id => deltaIds.includes(id))).toEqual([])
    for (const count of idCounts(composition).values()) expect(count).toBe(1)
    // The generated file is an ENTRY LIST the platform loader mounts verbatim,
    // so it must parse under the loader's own YAML dialect (!!js and all);
    // a text-level assertion alone cannot tell a mountable file from a broken
    // one with the right substrings.
    const parsed = rowIds(cordisRows(loadOverlayPatches('test', join(home, '.agent-presets', 'evolution-ptc', 'agent.cordis.yml'))))
    expect(parsed).toEqual([...rowIdList(PTC_FIXTURE), ...deltaIds])
    // 5. The V10-14 cap still lands on the PTC preset's own tool-skill row.
    const capStart = composition.search(/^- id: tool-skill$/m)
    expect(capStart).toBeGreaterThanOrEqual(0)
    const rowEnd = composition.indexOf('\n- id:', capStart)
    expect(composition.slice(capStart, rowEnd === -1 ? undefined : rowEnd)).toContain('catalogDescriptionMaxLength: 60')

    // 6. The variant publishes its OWN display metadata — the platform
    //    localizes shipped preset ids only, so copied text would list as a
    //    second, indistinguishable "Evolution".
    const variant = await readFile(join(home, '.agent-presets', 'evolution-ptc', 'preset.yml'), 'utf8')
    expect(variant).toBe(await readFile(join(agentPackage, 'preset.ptc.yml'), 'utf8'))
    expect(variant).toContain('name: Evolution PTC')
    expect(variant).toContain('Based on the platform ptc preset')
    expect(variant).toContain('family rows')
    expect(variant).not.toBe(await readFile(join(agentPackage, 'preset.yml'), 'utf8'))
    // 7. The variant install touched no other base's directory.
    expect(existsSync(join(home, '.agent-presets', 'evolution'))).toBe(false)
  })

  it('composes the RUNTIME platform ptc preset (no fixture root) with the family delta', async () => {
    // Without DSH_AGENT_PRESET_ROOT the installer resolves the agent-preset
    // root by walking up from its own location — inside this monorepo, the real
    // platform tree. This is the acceptance target: the RUNTIME ptc preset plus
    // the family delta. If a future platform stops shipping `ptc`, --base ptc
    // must fail loud rather than compose another base, and this case is where
    // that contract is re-decided deliberately.
    const home = await tempRoot('dsh-preset-base-runtime-')
    const { stdout } = await runInstaller(home, 'agent', ['--base', 'ptc'])
    expect(stdout).toContain(join(home, '.agent-presets', 'evolution-ptc'))

    const root = platformPresetRoot()
    const platformPtc = join(root, 'ptc', 'agent.cordis.yml')
    const platformStandard = join(root, 'standard', 'agent.cordis.yml')
    expect(existsSync(platformPtc)).toBe(true)
    const platform = await readFile(platformPtc, 'utf8')
    const composition = await readFile(join(home, '.agent-presets', 'evolution-ptc', 'agent.cordis.yml'), 'utf8')
    const delta = await readFile(join(agentPackage, 'agent.cordis.yml'), 'utf8')
    expect(rowIdList(composition)).toEqual([...rowIdList(platform), ...rowIdList(delta)])
    // No row appears twice: a vendored platform row (or a delta row absorbed
    // into the platform fragment) would double-mount the model tool.
    for (const [id, count] of idCounts(composition)) expect([id, count]).toEqual([id, 1])
    // The generated file parses under the platform loader's own YAML dialect.
    expect(rowIds(cordisRows(loadOverlayPatches('test', join(home, '.agent-presets', 'evolution-ptc', 'agent.cordis.yml')))))
      .toEqual(rowIdList(composition))
    // Base selection proved by content: the presentation row is PTC's, and the
    // sibling standard preset does not carry it at all.
    expect(rowIdList(platform)).toContain('tool-presentation')
    expect(rowIdList(await readFile(platformStandard, 'utf8'))).not.toContain('tool-presentation')
    expect(composition).toContain('- id: tool-presentation')
    expect(composition).toContain('mode: ptc')
    expect(composition).toContain('- id: present')
  })

  it('refuses an unknown base by name, before any write', async () => {
    const home = await tempRoot('dsh-preset-base-unknown-')
    const error = await runInstaller(home, 'agent', ['--base', 'nonsense'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.stderr).toContain('unknown agent-preset base')
    expect(error?.stderr).toContain('standard, ptc')
    // Fail-loud means no half-state: nothing under .agent-presets at all.
    expect(existsSync(join(home, '.agent-presets'))).toBe(false)

    // A value-less --base is a usage error, not a silent default.
    const missing = await runInstaller(home, 'agent', ['--base'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(missing?.stderr).toContain('--base requires a value')

    // Inherited property names are not bases (the lookup is own-property only),
    // a padded name is the same base, and the table is case-sensitive.
    const resolved = await callInstaller("return ['constructor', '__proto__', 'toString', ' ptc ', 'standard', 'PTC', ''].map(name => { try { return installer.resolveAgentPresetBase(name).base } catch { return '<threw>' } })")
    expect(resolved).toEqual(['<threw>', '<threw>', '<threw>', 'ptc', 'standard', '<threw>', '<threw>'])
  })

  it('refuses --base ptc when the runtime carries no ptc composition', async () => {
    // An explicit preset root is an answer, not the head of a fallback chain:
    // a standard-only root must NOT satisfy --base ptc.
    const home = await tempRoot('dsh-preset-base-missing-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'standard'), { recursive: true })
    await writeFile(join(presetRoot, 'standard', 'agent.cordis.yml'), STANDARD_FIXTURE)
    const error = await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain(join(presetRoot, 'ptc', 'agent.cordis.yml'))
    expect(existsSync(join(home, '.agent-presets'))).toBe(false)
  })

  it('sees a variant preset when refusing a one-click install (E-33 sweep covers every base)', async () => {
    const home = await tempRoot('dsh-preset-base-e33-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'ptc'), { recursive: true })
    await writeFile(join(presetRoot, 'ptc', 'agent.cordis.yml'), PTC_FIXTURE)
    await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(existsSync(join(home, '.agent-presets', 'evolution-ptc', 'agent.cordis.yml'))).toBe(true)
    // The one-click bundle mounts the same model rows at profile root, so it
    // must refuse beside a preset of ANY base — a sweep narrowed to the default
    // base would install straight into the double mount.
    const error = await runInstaller(home, 'oneclick')
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain('already carries an Evolution agent preset')
    expect(error?.stderr).toContain('evolution-ptc')
  })

  it('keeps the base table and the shipped assets consistent (structure, not prose)', async () => {
    // One table, four consumers (composition source, destination, metadata,
    // sweeps). These assertions are what stop a base from being added half-way:
    // an id the platform would refuse as a directory name, or a metadata file
    // the package does not ship, fails here instead of at a user's first
    // install.
    const table = await callInstaller('return installer.AGENT_PRESET_BASES') as Record<string, { id: string; metadata: string }>
    expect(Object.keys(table)).toEqual(['standard', 'ptc'])
    // The platform's own PRESET_ID (packages/preset/agent-presets/src/preset.ts):
    // an id is a directory name under the preset root, so this is a containment
    // rule rather than a style one. Inlined because evolution-host declares no
    // dependency on dsh-agent-presets.
    const presetId = /^[a-z0-9][a-z0-9-]*$/
    const shipped = new Set(await readdir(agentPackage))
    for (const entry of Object.values(table)) {
      expect(entry.id).toMatch(presetId)
      expect(shipped.has(entry.metadata)).toBe(true)
    }
    // Distinct directories: two bases sharing one id would overwrite each
    // other's composition and list one preset twice.
    expect(Object.values(table).map(entry => entry.id)).toEqual(['evolution', 'evolution-ptc'])
  })

  it('removes every family preset directory on a base-less uninstall, one when narrowed', async () => {
    const home = await tempRoot('dsh-preset-base-uninstall-')
    const presetRoot = join(home, 'preset')
    for (const [base, composition] of [['standard', STANDARD_FIXTURE], ['ptc', PTC_FIXTURE]] as const) {
      await mkdir(join(presetRoot, base), { recursive: true })
      await writeFile(join(presetRoot, base, 'agent.cordis.yml'), composition)
    }
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect((await readdir(join(home, '.agent-presets'))).sort()).toEqual(['evolution', 'evolution-ptc'])

    // A base-narrowed uninstall takes exactly that variant.
    await runInstaller(home, 'agent', ['--base', 'ptc', '--uninstall'])
    expect(await readdir(join(home, '.agent-presets'))).toEqual(['evolution'])

    // A base-less uninstall is not narrowed: a variant left behind would keep
    // mounting family model rows for any session that selects it.
    await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    await runInstaller(home, 'agent', ['--uninstall'])
    expect(existsSync(join(home, '.agent-presets', 'evolution'))).toBe(false)
    expect(existsSync(join(home, '.agent-presets', 'evolution-ptc'))).toBe(false)
  })
})
