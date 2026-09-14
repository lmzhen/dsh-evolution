import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
    // Await an async IIFE: a body may call an async entry point
    // (checkAgentPresetFreshness), and JSON.stringify(promise) would print `{}`.
    `const value = await (async () => { ${body} })()`,
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

/**
 * The status word `--check-presets` printed for one destination, or undefined.
 * The destination and the status are separated by two spaces, and the match is
 * on the whole destination: `evolution` must not answer for `evolution-ptc`.
 * @param stdout - the check run's stdout.
 * @param destination - the preset directory to look up.
 * @returns `fresh` | `DIFFERS` | `absent`, or undefined when no line names it.
 */
function presetStatus(stdout: string, destination: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const match = /^preset:\s+(.*?)\s{2}(\S+)\s*$/.exec(line)
    if (match?.[1] === destination) return match[2]
  }
  return undefined
}

/**
 * Every directory and file under `root` with its bytes — the probe for "the
 * check wrote nothing". Content, not just existence: an overwrite that kept the
 * size would still show up here.
 * @param root - the directory to walk.
 * @returns one record per entry, in sorted order.
 */
async function treeSnapshot(root: string): Promise<string[]> {
  const records: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        records.push(`dir  ${relative}`)
        await walk(join(dir, entry.name), relative)
      } else {
        records.push(`file ${relative} ${(await readFile(join(dir, entry.name))).toString('base64')}`)
      }
    }
  }
  await walk(root, '')
  return records
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
      `cordis:${join('H', '.agent-presets', 'evolution-cordis')}`,
      `minimal:${join('H', '.agent-presets', 'evolution-minimal')}`,
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

  it('one pass with --base standard,ptc writes both variants, each following ITS OWN runtime composition', async () => {
    const home = await tempRoot('dsh-preset-base-multi-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'standard'), { recursive: true })
    await mkdir(join(presetRoot, 'ptc'), { recursive: true })
    await writeFile(join(presetRoot, 'standard', 'agent.cordis.yml'), STANDARD_FIXTURE)
    await writeFile(join(presetRoot, 'ptc', 'agent.cordis.yml'), PTC_FIXTURE)
    await runInstaller(home, 'agent', ['--base', 'standard,ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })

    // The whole point of a multi-base install: two files, each composed from the
    // platform composition of its OWN base — never one composition copied under
    // two names (the ptc variant carries the ptc rows, the standard one does
    // not).
    const standardComposition = await readFile(join(home, '.agent-presets', 'evolution', 'agent.cordis.yml'), 'utf8')
    const ptcComposition = await readFile(join(home, '.agent-presets', 'evolution-ptc', 'agent.cordis.yml'), 'utf8')
    expect(standardComposition.split('\n')[0]).toBe(STANDARD_FIXTURE.split('\n')[0])
    expect(ptcComposition.split('\n')[0]).toBe(PTC_FIXTURE.split('\n')[0])
    expect(standardComposition).not.toContain('- id: tool-presentation')
    expect(ptcComposition).toContain('mode: ptc')
    // The metadata follows the base as well: a variant must publish its own
    // display text, never the standard preset's.
    expect(await readFile(join(home, '.agent-presets', 'evolution', 'preset.yml'), 'utf8'))
      .toBe(await readFile(join(agentPackage, 'preset.yml'), 'utf8'))
    expect(await readFile(join(home, '.agent-presets', 'evolution-ptc', 'preset.yml'), 'utf8'))
      .toBe(await readFile(join(agentPackage, 'preset.ptc.yml'), 'utf8'))

    // The selection is a SET resolved in table order, so repeats and a reversed
    // spelling produce the same run.
    const resolved = await callInstaller("return installer.resolveAgentPresetBases(['ptc', 'standard,ptc']).map(entry => entry.base)")
    expect(resolved).toEqual(['standard', 'ptc'])
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

  it('names the two product forms: --mode variant = layered, --mode attach = oneclick (0.3.77)', async () => {
    const home = await tempRoot('dsh-preset-form-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'standard'), { recursive: true })
    await writeFile(join(presetRoot, 'standard', 'agent.cordis.yml'), STANDARD_FIXTURE)
    // The product names are ALIASES of the historical modes, not a second mode
    // table: variant resolves to layered (host bundle + generated preset) and
    // attach to the one-click preset bundle. The summary names the form, so an
    // operator sees which of the two mutually exclusive layouts (E-33) this run
    // installs without decoding the mode name.
    const variant = await runInstaller(home, 'variant', ['--dry-run'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(variant.stdout).toContain('mode:     layered')
    expect(variant.stdout).toContain('form:     variant')
    // The alias table is closed: a near-miss fails loud instead of falling back
    // to the default mode.
    const bad = await runInstaller(home, 'variantt', ['--dry-run'], { DSH_AGENT_PRESET_ROOT: presetRoot })
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(bad?.stderr).toContain('unknown mode variantt')
  })

  it('G1-② (0.3.78): refuses a registered-but-unusable base with its reason, install-time', async () => {
    // The two platform bases the family cannot derive a variant from are
    // REGISTERED with their reason instead of failing later at mount: minimal has
    // no skill landing surface at all, cordis needs a provider only a web-app
    // deployment mounts. The installer judges the latter from the target
    // profile's bundle rows; the command (same table) asks ctx.get for the
    // service itself.
    const probe = await callInstaller(
      'const q = (name, bundles) => String(installer.baseUnavailableReason({ name, ...installer.AGENT_PRESET_BASES[name] }, bundles))'
      + '; return [q(\'minimal\', []), q(\'cordis\', []), q(\'cordis\', [\'@deepseek-ai/dsh-web-app\']), q(\'standard\', [])]',
    ) as string[]
    expect(probe[0]).toContain('UNSUPPORTED')
    expect(probe[1]).toContain('dynamicCordisRunner')
    expect(probe[2]).toBe('undefined')
    expect(probe[3]).toBe('undefined')
    // ...and the refusal is what an install reports, before any mutation.
    const home = await tempRoot('dsh-preset-unsupported-')
    const error = await runInstaller(home, 'agent', ['--base', 'minimal'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain('UNSUPPORTED')
    expect(existsSync(join(home, '.agent-presets'))).toBe(false)
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

    // A typo in the SECOND name of a multi-base selection writes nothing: every
    // name is resolved before the first variant is composed.
    const mixedHome = await tempRoot('dsh-preset-base-unknown2-')
    const mixed = await runInstaller(mixedHome, 'agent', ['--base', 'standard,nonsense'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(mixed?.stderr).toContain('unknown agent-preset base')
    expect(existsSync(join(mixedHome, '.agent-presets'))).toBe(false)

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
    // 0.3.78 (G1-②): the table also REGISTERS the two platform bases the family
    // cannot derive a variant from, each with the reason it cannot.
    expect(Object.keys(table)).toEqual(['standard', 'ptc', 'cordis', 'minimal'])
    // The table is a DATA file the runtime command reads too
    // (evolution-agent/bases.json): a literal in each consumer is exactly how
    // the npm path stayed on `standard` while the installer knew `ptc`.
    const basesJson = JSON.parse(await readFile(join(agentPackage, 'bases.json'), 'utf8')) as {
      default: string
      bases: Array<{ name: string; id: string; metadata: string; requires?: { service: string }; unsupported?: string }>
    }
    // toMatchObject, not toEqual: the table may carry the ability fields
    // (requires/unsupported, 0.3.78) that the runtime command also reads; the
    // identity fields are the ones every consumer must agree on.
    for (const base of basesJson.bases) {
      expect(table[base.name], base.name).toMatchObject({ id: base.id, metadata: base.metadata })
    }
    expect(Object.keys(table)[0]).toBe(basesJson.default)
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
    expect(Object.values(table).map(entry => entry.id)).toEqual(['evolution', 'evolution-ptc', 'evolution-cordis', 'evolution-minimal'])
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

  it('G3-①: --check-presets reports a freshly installed variant fresh and writes nothing', async () => {
    const home = await tempRoot('dsh-preset-freshness-fresh-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'standard'), { recursive: true })
    await writeFile(join(presetRoot, 'standard', 'agent.cordis.yml'), STANDARD_FIXTURE)
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    const destination = join(home, '.agent-presets', 'evolution')
    const before = await treeSnapshot(home)

    // Exit 0 is the absence of a rejection: execFile rejects on a non-zero exit.
    const { stdout } = await runInstaller(home, 'agent', ['--check-presets'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(presetStatus(stdout, destination)).toBe('fresh')
    // A base the user never installed is absent, not stale — and an unusable base
    // is not reported at all (it has no fresh install to compare against).
    expect(presetStatus(stdout, join(home, '.agent-presets', 'evolution-ptc'))).toBe('absent')
    expect(stdout).not.toContain('evolution-cordis')
    expect(stdout).not.toContain('evolution-minimal')
    // The report says what a difference means, and that it is not a repair.
    expect(stdout).toContain('install-time snapshot')
    expect(stdout).toContain('never overwrites')
    // ...and it is a READ: not one byte under the home may move.
    expect(await treeSnapshot(home)).toEqual(before)
  })

  it('G3-①: --check-presets reports DIFFERS with exit 1 and never repairs the file', async () => {
    const home = await tempRoot('dsh-preset-freshness-stale-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'standard'), { recursive: true })
    await writeFile(join(presetRoot, 'standard', 'agent.cordis.yml'), STANDARD_FIXTURE)
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    const destination = join(home, '.agent-presets', 'evolution')
    const compositionPath = join(destination, 'agent.cordis.yml')
    // One hand-edited line stands in for every way the file can drift from what a
    // fresh install would write: a platform change, a family upgrade, a user edit.
    const edited = (await readFile(compositionPath, 'utf8')).replace('- id: persona', '- id: persona-edited')
    await writeFile(compositionPath, edited)

    const failure = await runInstaller(home, 'agent', ['--check-presets'], { DSH_AGENT_PRESET_ROOT: presetRoot })
      .then(() => null, (caught: unknown) => caught as { code?: number; stdout?: string })
    expect(failure).not.toBeNull()
    expect(failure?.code).toBe(1)
    // The line NAMES the stale destination, so a user with several variants knows
    // which file to regenerate.
    expect(failure?.stdout).toContain(destination)
    expect(presetStatus(failure?.stdout ?? '', destination)).toBe('DIFFERS')

    // "Report, never overwrite" is the whole point: the check is not a repair
    // pass, so the edit survives it and no temp file is left behind.
    expect(await readFile(compositionPath, 'utf8')).toBe(edited)
    expect(await readFile(compositionPath, 'utf8')).toContain('persona-edited')
    expect((await readdir(destination)).sort()).toEqual(['agent.cordis.yml', 'preset.yml'])
  })

  it('G3-①: --check-presets reports a missing composition absent, exit 0, and skips unusable bases', async () => {
    const home = await tempRoot('dsh-preset-freshness-absent-')
    const presetRoot = join(home, 'preset')
    await mkdir(join(presetRoot, 'standard'), { recursive: true })
    await writeFile(join(presetRoot, 'standard', 'agent.cordis.yml'), STANDARD_FIXTURE)
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    const destination = join(home, '.agent-presets', 'evolution')
    // Absent is not an error: the user may simply not have kept this variant, so
    // a removed composition must not turn into a failing check.
    await rm(join(destination, 'agent.cordis.yml'))
    const { stdout } = await runInstaller(home, 'agent', ['--check-presets'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(presetStatus(stdout, destination)).toBe('absent')
    expect(presetStatus(stdout, join(home, '.agent-presets', 'evolution-ptc'))).toBe('absent')
    expect(existsSync(join(destination, 'agent.cordis.yml'))).toBe(false)

    // The library shape behind the flag: one record per INSTALLABLE base, each
    // carrying the directory and preset id a caller needs to act on the report.
    // minimal (registered unsupported) and cordis (needs a web-app profile, and
    // this home has none) are skipped rather than called stale.
    const emptyHome = await tempRoot('dsh-preset-freshness-shape-')
    const report = await callInstaller(`return installer.checkAgentPresetFreshness({ home: ${JSON.stringify(emptyHome)} })`) as {
      bases: Array<{ base: string; id: string; destination: string; status: string }>
    }
    expect(report.bases).toEqual([
      { base: 'standard', id: 'evolution', destination: join(emptyHome, '.agent-presets', 'evolution'), status: 'absent' },
      { base: 'ptc', id: 'evolution-ptc', destination: join(emptyHome, '.agent-presets', 'evolution-ptc'), status: 'absent' },
    ])
  })
})
