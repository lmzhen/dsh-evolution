import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { cordisRows, rowId, rowIds } from '../../test-support/cordis-rows.ts'
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

async function runInstaller(home: string, mode: string, extra: string[] = [], env: Record<string, string> = {}) {
  return run(process.execPath, [installer, '--mode', mode, '--profile', 'evo-base', '--home', home, ...extra], {
    env: { ...process.env, ...env },
  })
}

/** The patch file the family preset row is written to — the profile's own layer
 * (`packages/boot/app-boot/src/profile.ts`, `PROFILE_PATCH_FILENAME`). */
function patchPath(home: string): string {
  return join(home, 'profiles', 'evo-base', 'cordis.patch.yml')
}

/**
 * One platform base preset patch in its SHIPPED form: a single `- insert:` entry whose row carries
 * the preset's plugin list under `config.plugins`
 * (`packages/bundle/web-app/presets/standard.patch.yml`).
 * @param headline - the fixture's first comment line, which identifies the file in the output.
 * @param rowLines - the plugin row lines, at column 0.
 * @returns the patch text.
 */
function basePatch(headline: string, rowLines: string[]): string {
  return [
    headline,
    '- insert:',
    '    - id: preset-fixture',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: fixture',
    '        order: 1',
    '        plugins:',
    ...rowLines.map(line => '          ' + line),
    '',
  ].join('\n')
}

/**
 * The `config.plugins` rows of the first inserted entry in one patch file, parsed by the
 * platform's own loader — the only reader that can tell a mountable patch from text with the right
 * substrings.
 * @param path - the patch file.
 * @returns the plugin rows.
 */
function insertedPlugins(path: string): Record<string, unknown>[] {
  const patches = loadOverlayPatches('test', path)
  const entry = patches.find(row => Array.isArray((row as { insert?: unknown }).insert))
  const inserted = (entry as { insert?: Array<{ config?: { plugins?: Record<string, unknown>[] } }> } | undefined)?.insert
  const plugins = inserted?.[0]?.config?.plugins
  if (!Array.isArray(plugins)) throw new Error(`${path} carries no inserted preset row with config.plugins`)
  return plugins
}

/** Ids of the plugin rows one patch file's inserted preset declares. */
function insertedPluginIds(path: string): (string | undefined)[] {
  return insertedPlugins(path).map(row => rowId(row))
}

/** The writer's report line for one preset row, or undefined when none names it. */
function presetLine(stdout: string, rowIdText: string): string | undefined {
  return stdout.split('\n').find(line => line.startsWith('preset:') && line.includes(rowIdText))
}

/** The status word `--check-presets` printed for one preset id, or undefined. */
function presetStatus(stdout: string, id: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const match = /^preset:\s+(\S+)\s+(.*?)\s{2}(\S+)\s*$/.exec(line)
    if (match?.[1] === id) return match[3]
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

/** Write one base patch fixture per base name and return the preset root. */
async function presetRootWith(home: string, fixtures: Record<string, string>): Promise<string> {
  const root = join(home, 'preset')
  await mkdir(root, { recursive: true })
  for (const [base, text] of Object.entries(fixtures)) await writeFile(join(root, `${base}.patch.yml`), text)
  return root
}

const STANDARD_FIXTURE = basePatch('# runtime standard fixture', [
  '- id: persona',
  '  name: "@deepseek-ai/dsh-persona"',
  '',
  '- id: tool-skill',
  '  name: "@deepseek-ai/dsh-tool-skill"',
])

const PTC_FIXTURE = basePatch('# runtime ptc fixture', [
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
])

const DELTA_FIXTURE = [
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

/** The identity the installer composes for one base, as the row it writes. */
const IDENTITY = {
  rowId: 'preset-evolution',
  id: 'evolution',
  name: 'Evolution',
  description: 'Standard coding agent plus durable memory and skill evolution tools.',
  order: 10,
}

/**
 * The installed `standard`-base row for the fixture pair above, captured from the
 * installer BEFORE the `--base` parameterization and frozen here. It is the
 * byte-identity pin for the default path — a change to the destination file, the
 * base-patch source, the composition rule, or the V10-14 cap injection moves
 * these bytes.
 */
const DEFAULT_BASE_GOLDEN = [
  '- insert:',
  '    - id: preset-evolution',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: evolution',
  '        name: "Evolution"',
  '        description: "Standard coding agent plus durable memory and skill evolution tools."',
  '        order: 10',
  '        plugins:',
  '          - id: persona',
  '            name: "@deepseek-ai/dsh-persona"',
  '          - id: tool-skill',
  '            name: "@deepseek-ai/dsh-tool-skill"',
  '            # V10-14: Hermes 60-char catalog cap — injected by the preset composer (P1-2);',
  '            # this preset-scope row is the session-visible instance and no profile',
  '            # patch can reach it. Remove only to run the platform default (500).',
  '            config:',
  '              catalogDescriptionMaxLength: 60',
  '          # evolution delta fixture',
  '          - id: tool-memory',
  '            name: "@deepseek-ai/dsh-tool-memory"',
  '          - id: tool-session-query',
  '            name: "@deepseek-ai/dsh-tool-session-query"',
  '',
].join('\n')

describe('agent preset bases (--base standard|ptc)', () => {
  it('composes the golden row for the fixture pair, and keeps one default base', async () => {
    const composed = await callInstaller(
      `return installer.composePresetEntry(${JSON.stringify(STANDARD_FIXTURE)}, ${JSON.stringify(DELTA_FIXTURE)}, ${JSON.stringify(IDENTITY)})`,
    )
    expect(composed).toBe(DEFAULT_BASE_GOLDEN)
    // One default, one table: the default base is a NAME resolved through
    // resolveAgentPresetBase, not a per-call-site fallback that could answer
    // differently at each site.
    const resolved = await callInstaller('return [installer.DEFAULT_AGENT_PRESET_BASE, installer.resolveAgentPresetBase().base, installer.resolveAgentPresetBase("standard").base]')
    expect(resolved).toEqual(['standard', 'standard', 'standard'])
    // The row id and the shipped display copy are derived from the table, so a
    // base cannot be half-added.
    const identities = await callInstaller('return Object.keys(installer.AGENT_PRESET_BASES).map(name => installer.presetIdentity(installer.resolveAgentPresetBase(name)))')
    expect(identities).toEqual([
      { rowId: 'preset-evolution', id: 'evolution', name: 'Evolution', description: 'Standard coding agent plus durable memory and skill evolution tools.', order: 10 },
      { rowId: 'preset-evolution-ptc', id: 'evolution-ptc', name: 'Evolution PTC', description: "Based on the platform ptc preset plus the Evolution family rows - durable memory and skill evolution tools, with run_code as the model's composition surface.", order: 11 },
      { rowId: 'preset-evolution-cordis', id: 'evolution-cordis', name: 'Evolution Cordis', description: 'Based on the platform cordis preset plus the Evolution family rows - the self-modification toolset with durable memory and skill evolution. Needs a deployment that provides dynamicCordisRunner (the web-app bundle).', order: 12 },
      { rowId: 'preset-evolution-minimal', id: 'evolution-minimal', name: 'Evolution Minimal', description: 'Registered but UNSUPPORTED - the platform minimal composition carries no tool-skill row, so the family skill surface has nothing to attach to.', order: 13 },
    ])
  })

  it('installs the default base as a row in the profile patch, byte-for-byte', async () => {
    const home = await tempRoot('dsh-preset-base-default-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
    // The frozen golden is the fixture PAIR, so the CLI wiring is pinned with
    // the same delta fixture the golden was captured with.
    const deltaPath = join(home, 'delta.fixture.yml')
    await writeFile(deltaPath, DELTA_FIXTURE)
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot, DSH_EVOLUTION_DELTA_PATH: deltaPath })
    expect(await readFile(patchPath(home), 'utf8')).toBe(DEFAULT_BASE_GOLDEN)
    // A default install writes the default base's row alone.
    expect(await readFile(patchPath(home), 'utf8')).not.toContain('preset-evolution-ptc')
  })

  it('G6: the written row parses under the platform loader and carries base + delta rows', async () => {
    // The text-level assertions above cannot tell a mountable patch from text
    // with the right substrings: the platform's own reader runs the Loader YAML
    // dialect (!!js and all) and is the only acceptance a patch really has. A
    // parse failure throws out of loadOverlayPatches — it is never caught here.
    const home = await tempRoot('dsh-preset-base-parse-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
    const { stdout } = await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(presetLine(stdout, 'preset-evolution')).toContain(patchPath(home))

    const baseRows = insertedPlugins(join(presetRoot, 'standard.patch.yml'))
    const plugins = insertedPlugins(patchPath(home))
    // A family row's plugin list is exactly the platform base rows followed by the
    // family delta rows — a dropped, duplicated or reordered source fails here.
    expect(plugins.map(row => rowId(row))).toEqual([...baseRows.map(row => rowId(row)), ...FAMILY_DELTA_IDS])
    expect(plugins).toHaveLength(baseRows.length + FAMILY_DELTA_IDS.length)
    // The preset identity the registry serves came through the same parse.
    const entry = loadOverlayPatches('test', patchPath(home)).find(row => Array.isArray((row as { insert?: unknown }).insert)) as {
      insert: Array<{ id: string; config: { id: string; name: string; description: string; order: number } }>
    }
    expect(entry.insert[0]?.id).toBe('preset-evolution')
    expect(entry.insert[0]?.config).toMatchObject({ id: 'evolution', name: 'Evolution', order: 10 })
    // The whole patch is a valid entry list for the loader, and the row it carries
    // is the only top-level item: a row at column 0 would be read as an OVERRIDE
    // of an existing platform row instead of a new preset.
    expect(rowIds(cordisRows(loadOverlayPatches('test', patchPath(home))))).toEqual([])
    // The V10-14 cap still lands on the base's own tool-skill row.
    const toolSkill = plugins.find(row => rowId(row) === 'tool-skill')
    expect(toolSkill).toMatchObject({ config: { catalogDescriptionMaxLength: 60 } })
  })

  it('composes the runtime ptc base rows plus the family delta under --base ptc, vendoring nothing', async () => {
    const home = await tempRoot('dsh-preset-base-ptc-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE, ptc: PTC_FIXTURE })
    await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })

    const patch = await readFile(patchPath(home), 'utf8')
    // The delta is base-independent: the SHARED evolution-agent composition.
    const deltaIds = rowIds(cordisRows(loadOverlayPatches('test', join(agentPackage, 'agent.cordis.yml'))))
    expect(deltaIds).toEqual(FAMILY_DELTA_IDS)
    // 1. The ptc base's rows come first and VERBATIM, and the standard fixture was
    //    NOT the source.
    expect(insertedPluginIds(patchPath(home))).toEqual([...insertedPluginIds(join(presetRoot, 'ptc.patch.yml')), ...deltaIds])
    expect(patch).not.toContain(STANDARD_FIXTURE.split('\n')[0] ?? '# runtime standard fixture')
    expect(patch).toContain('mode: ptc')
    expect(patch).toContain('preset-evolution-ptc')
    // 2. Nothing is vendored and nothing is duplicated.
    expect(insertedPluginIds(patchPath(home)).filter(id => id === 'tool-presentation')).toHaveLength(1)
    const ptcPlugins = insertedPlugins(patchPath(home))
    expect(ptcPlugins).toHaveLength(insertedPlugins(join(presetRoot, 'ptc.patch.yml')).length + deltaIds.length)
    // 3. The variant publishes its OWN display copy — the platform localizes
    //    shipped preset ids only, so copied text would list as a second,
    //    indistinguishable "Evolution".
    const variant = (loadOverlayPatches('test', patchPath(home)).find(row => Array.isArray((row as { insert?: unknown }).insert)) as {
      insert: Array<{ config: { id: string; name: string; description: string; order: number } }>
    }).insert[0]?.config
    expect(variant).toMatchObject({ id: 'evolution-ptc', name: 'Evolution PTC', order: 11 })
    expect(variant?.description).toContain('Based on the platform ptc preset')
    expect(variant?.name).not.toBe('Evolution')
    // 4. The ptc-variant install wrote no standard row.
    expect(patch).not.toContain('preset-evolution\n')
  })

  it('one pass with --base standard,ptc writes both rows into the one profile patch', async () => {
    const home = await tempRoot('dsh-preset-base-multi-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE, ptc: PTC_FIXTURE })
    await runInstaller(home, 'agent', ['--base', 'standard,ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })

    // The whole point of a multi-base install: two rows, each composed from the
    // base patch of its OWN base — never one composition copied under two names.
    const patch = await readFile(patchPath(home), 'utf8')
    expect(patch).toContain('preset-evolution\n')
    expect(patch).toContain('preset-evolution-ptc\n')
    const entries = loadOverlayPatches('test', patchPath(home))
    const ids = entries.flatMap(row => ((row as { insert?: Array<{ id: string }> }).insert ?? []).map(item => item.id))
    expect(ids).toEqual(['preset-evolution', 'preset-evolution-ptc'])
    type Entry = { insert: Array<{ config: { plugins: Record<string, unknown>[] } }> }
    const standardPlugins = (entries[0] as Entry).insert[0]?.config.plugins ?? []
    const ptcPlugins = (entries[1] as Entry).insert[0]?.config.plugins ?? []
    expect(standardPlugins.map(row => rowId(row))).not.toContain('tool-presentation')
    expect(ptcPlugins.map(row => rowId(row))).toContain('tool-presentation')
    // The selection is a SET resolved in table order, so repeats and a reversed
    // spelling produce the same run.
    const resolved = await callInstaller("return installer.resolveAgentPresetBases(['ptc', 'standard,ptc']).map(entry => entry.base)")
    expect(resolved).toEqual(['standard', 'ptc'])
  })

  it('composes the RUNTIME platform ptc preset patch (no fixture root) with the family delta', async () => {
    // Without DSH_AGENT_PRESET_ROOT the installer resolves the base patch by
    // walking up to the platform tree's bundle packages — inside this monorepo,
    // the real platform. This is the acceptance target: the RUNTIME ptc preset
    // plus the family delta. If a future platform stops shipping `ptc`,
    // --base ptc must fail loud rather than compose another base, and this case
    // is where that contract is re-decided deliberately.
    const home = await tempRoot('dsh-preset-base-runtime-')
    const { stdout } = await runInstaller(home, 'agent', ['--base', 'ptc'])
    expect(stdout).toContain(patchPath(home))

    const platformPtc = platformBasePatch('ptc')
    const platformStandard = platformBasePatch('standard')
    const delta = join(agentPackage, 'agent.cordis.yml')
    expect(insertedPluginIds(patchPath(home))).toEqual([...insertedPluginIds(platformPtc), ...rowIds(cordisRows(loadOverlayPatches('test', delta)))])
    expect(insertedPlugins(patchPath(home))).toHaveLength(insertedPlugins(platformPtc).length + FAMILY_DELTA_IDS.length)
    // No row appears twice: a vendored platform row (or a delta row absorbed
    // into the platform fragment) would double-mount the model tool.
    const ids = insertedPluginIds(patchPath(home))
    for (const id of ids) expect(ids.filter(candidate => candidate === id)).toHaveLength(1)
    // Base selection proved by content: the presentation row is PTC's, and the
    // sibling standard base patch does not carry it at all.
    expect(insertedPluginIds(platformPtc)).toContain('tool-presentation')
    expect(insertedPluginIds(platformStandard)).not.toContain('tool-presentation')
    const patch = await readFile(patchPath(home), 'utf8')
    expect(patch).toContain('tool-presentation')
    expect(patch).toContain('mode: ptc')
    expect(patch).toContain('preset-evolution-ptc')
  })

  it('names the two product forms: --mode variant = layered, --mode attach = oneclick (0.3.77)', async () => {
    const home = await tempRoot('dsh-preset-form-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
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
    // profile's bundle rows because it cannot see the runtime service store;
    // the command (same table) asks ctx.get for the service itself.
    const probe = await callInstaller(
      'const q = (name, bundles) => String(installer.baseUnavailableReason({ name, ...installer.AGENT_PRESET_BASES[name] }, bundles))'
      + "; return [q('minimal', []), q('cordis', []), q('cordis', ['@deepseek-ai/dsh-web-app']), q('standard', [])]",
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
    expect(existsSync(join(home, 'profiles'))).toBe(false)
  })

  it('refuses an unknown base by name, before any write', async () => {
    const home = await tempRoot('dsh-preset-base-unknown-')
    const error = await runInstaller(home, 'agent', ['--base', 'nonsense'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.stderr).toContain('unknown agent-preset base')
    expect(error?.stderr).toContain('standard, ptc')
    // Fail-loud means no half-state: no profile and no patch at all.
    expect(existsSync(join(home, 'profiles'))).toBe(false)

    // A typo in the SECOND name of a multi-base selection writes nothing: every
    // name is resolved before the first row is composed.
    const mixedHome = await tempRoot('dsh-preset-base-unknown2-')
    const mixed = await runInstaller(mixedHome, 'agent', ['--base', 'standard,nonsense'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(mixed?.stderr).toContain('unknown agent-preset base')
    expect(existsSync(join(mixedHome, 'profiles'))).toBe(false)

    // A value-less --base is a usage error, not a silent default.
    const missing = await runInstaller(home, 'agent', ['--base'])
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(missing?.stderr).toContain('--base requires a value')

    // Inherited property names are not bases (the lookup is own-property only),
    // a padded name is the same base, and the table is case-sensitive.
    const resolved = await callInstaller("return ['constructor', '__proto__', 'toString', ' ptc ', 'standard', 'PTC', ''].map(name => { try { return installer.resolveAgentPresetBase(name).base } catch { return '<threw>' } })")
    expect(resolved).toEqual(['<threw>', '<threw>', '<threw>', 'ptc', 'standard', '<threw>', '<threw>'])
  })

  it('refuses --base ptc when the explicit preset root carries no ptc patch', async () => {
    // An explicit root is an answer, not the head of a fallback chain: a
    // standard-only root must NOT satisfy --base ptc.
    const home = await tempRoot('dsh-preset-base-missing-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
    const error = await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain(join(presetRoot, 'ptc.patch.yml'))
    expect(error?.stderr).toContain('DSH_AGENT_PRESET_ROOT')
    // The failure names the escape that always works on a desktop install, whose
    // platform packages live inside resources/app.asar.
    expect(error?.stderr).toContain('packages/bundle/web-app/presets/')
  })

  it('sees an installed variant row when refusing a one-click install (E-33 sweep covers every base)', async () => {
    const home = await tempRoot('dsh-preset-base-e33-')
    const presetRoot = await presetRootWith(home, { ptc: PTC_FIXTURE })
    await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(existsSync(patchPath(home))).toBe(true)
    // The one-click bundle mounts the same model rows at profile root, so it must
    // refuse beside a preset row of ANY base — a sweep narrowed to the default
    // base would install straight into the double mount.
    const error = await runInstaller(home, 'oneclick')
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain('already carries an Evolution agent preset row')
    expect(error?.stderr).toContain('preset-evolution-ptc')
    // ...and the exclusion is PER PROFILE: a row in another profile's patch cannot
    // double-mount anything here, so a second profile installs normally.
    const other = await tempRoot('dsh-preset-base-e33-other-')
    const otherRoot = await presetRootWith(other, { ptc: PTC_FIXTURE })
    await runInstaller(other, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: otherRoot })
    const sibling = await run(process.execPath, [installer, '--mode', 'oneclick', '--profile', 'second', '--home', other])
    expect(sibling.stdout).toContain('bundle:   @deepseek-ai/dsh-evolution-preset')
  })

  it('keeps the base table and the shipped assets consistent (structure, not prose)', async () => {
    // One table, four consumers (base patch, row identity, display copy, refusal
    // sweeps). These assertions are what stop a base from being added half-way:
    // an id the platform would refuse, or display copy the picker cannot read,
    // fails here instead of at a user's first install.
    const table = await callInstaller('return installer.AGENT_PRESET_BASES') as Record<string, { id: string; display: { name: string; description: string; order: number } }>
    // 0.3.78 (G1-②): the table also REGISTERS the two platform bases the family
    // cannot derive a variant from, each with the reason it cannot.
    expect(Object.keys(table)).toEqual(['standard', 'ptc', 'cordis', 'minimal'])
    // The table is a DATA file the runtime command reads too
    // (evolution-agent/bases.json): a literal in each consumer is exactly how
    // the npm path stayed on `standard` while the installer knew `ptc`.
    const basesJson = JSON.parse(await readFile(join(agentPackage, 'bases.json'), 'utf8')) as {
      default: string
      bases: Array<{
        name: string
        id: string
        display: { name: string; description: string; order: number }
        requires?: { service: string }
        unsupported?: string
      }>
    }
    // toMatchObject, not toEqual: the table may carry the ability fields
    // (requires/unsupported, 0.3.78) that the runtime command also reads; the
    // identity fields are the ones every consumer must agree on.
    for (const base of basesJson.bases) {
      expect(table[base.name], base.name).toMatchObject({ id: base.id, display: base.display })
    }
    expect(Object.keys(table)[0]).toBe(basesJson.default)
    // The platform's own PRESET_ID (packages/preset/agent-preset-registry/src/preset.ts):
    // the id is the preset identity the registry keys on. Inlined because
    // evolution-host declares no dependency on the registry package.
    const presetId = /^[a-z0-9][a-z0-9-]*$/
    // The display copy is REQUIRED: the platform localizes its SHIPPED ids only
    // (packages/preset/agent-preset-registry/src/display.ts:47-72), so a row
    // without a name would list as its bare id.
    for (const entry of Object.values(table)) {
      expect(entry.id).toMatch(presetId)
      expect(entry.display.name.length).toBeGreaterThan(0)
      expect(entry.display.description.length).toBeGreaterThan(0)
      expect(Number.isInteger(entry.display.order)).toBe(true)
    }
    // Distinct ids: two bases sharing one id would register one preset twice.
    expect(Object.values(table).map(entry => entry.id)).toEqual(['evolution', 'evolution-ptc', 'evolution-cordis', 'evolution-minimal'])
    expect(Object.values(table).map(entry => entry.display.order)).toEqual([10, 11, 12, 13])
  })

  it('removes every family preset row on a base-less uninstall, one when narrowed', async () => {
    const home = await tempRoot('dsh-preset-base-uninstall-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE, ptc: PTC_FIXTURE })
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    const ids = async (): Promise<string[]> => loadOverlayPatches('test', patchPath(home))
      .flatMap(row => ((row as { insert?: Array<{ id: string }> }).insert ?? []).map(item => item.id))
    expect(await ids()).toEqual(['preset-evolution', 'preset-evolution-ptc'])

    // A base-narrowed uninstall takes exactly that row.
    await runInstaller(home, 'agent', ['--base', 'ptc', '--uninstall'])
    expect(await ids()).toEqual(['preset-evolution'])

    // A base-less uninstall is not narrowed: a row left behind would keep
    // mounting family model rows for any session that selects it. The entry
    // goes with its last row, and the patch keeps the platform's empty-list seed.
    await runInstaller(home, 'agent', ['--base', 'ptc'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    const removed = await runInstaller(home, 'agent', ['--uninstall'])
    expect(removed.stdout).toMatch(/preset:\s+true/)
    expect(await readFile(patchPath(home), 'utf8')).toBe('[]\n')
  })

  it('G3-①: --check-presets reports a freshly installed row fresh and writes nothing', async () => {
    const home = await tempRoot('dsh-preset-freshness-fresh-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    const before = await treeSnapshot(home)

    // Exit 0 is the absence of a rejection: execFile rejects on a non-zero exit.
    const { stdout } = await runInstaller(home, 'agent', ['--check-presets'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(presetStatus(stdout, 'evolution')).toBe('fresh')
    // A base the user never installed is absent, not stale — and an unusable base
    // is not reported at all (it has no fresh install to compare against).
    expect(presetStatus(stdout, 'evolution-ptc')).toBe('absent')
    expect(stdout).not.toContain('evolution-cordis')
    expect(stdout).not.toContain('evolution-minimal')
    // The report says what a difference means, and that it is not a repair.
    expect(stdout).toContain('install-time snapshot')
    expect(stdout).toContain('never overwrites')
    // ...and it is a READ: not one byte under the home may move.
    expect(await treeSnapshot(home)).toEqual(before)
  })

  it('G3-①: --check-presets reports DIFFERS with exit 1 and never repairs the row', async () => {
    const home = await tempRoot('dsh-preset-freshness-stale-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    // One hand-edited line stands in for every way the row can drift from what a
    // fresh install would write: a platform change, a family upgrade, a user edit.
    const edited = (await readFile(patchPath(home), 'utf8')).replace('- id: persona', '- id: persona-edited')
    await writeFile(patchPath(home), edited)

    const failure = await runInstaller(home, 'agent', ['--check-presets'], { DSH_AGENT_PRESET_ROOT: presetRoot })
      .then(() => null, (caught: unknown) => caught as { code?: number; stdout?: string })
    expect(failure).not.toBeNull()
    expect(failure?.code).toBe(1)
    // The line NAMES the stale patch, so a user with several bases knows which
    // row to regenerate.
    expect(failure?.stdout).toContain(patchPath(home))
    expect(presetStatus(failure?.stdout ?? '', 'evolution')).toBe('DIFFERS')
    // "Report, never overwrite" is the whole point: the check is not a repair
    // pass, so the edit survives it and no temp file is left behind.
    expect(await readFile(patchPath(home), 'utf8')).toBe(edited)
    expect((await readdir(join(patchPath(home), '..'))).sort()).toEqual([
      '.evolution-install.json',
      'cordis.patch.yml',
      'package.json',
      'pnpm-workspace.yaml',
    ])
  })

  it('G3-①: --check-presets reports a removed row absent, exit 0, and skips unusable bases', async () => {
    const home = await tempRoot('dsh-preset-freshness-absent-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    // Absent is not an error: the user may simply not have kept this base, so a
    // removed row must not turn into a failing check.
    await writeFile(patchPath(home), '[]\n')
    const { stdout } = await runInstaller(home, 'agent', ['--check-presets'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(presetStatus(stdout, 'evolution')).toBe('absent')
    expect(presetStatus(stdout, 'evolution-ptc')).toBe('absent')

    // The library shape behind the flag: one record per INSTALLABLE base, each
    // carrying the patch a caller needs to act on the report. minimal (registered
    // unsupported) and cordis (needs a web-app profile, and this home has none)
    // are skipped rather than called stale.
    const emptyHome = await tempRoot('dsh-preset-freshness-shape-')
    const report = await callInstaller(`return installer.checkAgentPresetFreshness({ home: ${JSON.stringify(emptyHome)} })`) as {
      bases: Array<{ base: string; id: string; patchPath: string; status: string }>
    }
    expect(report.bases).toEqual([
      { base: 'standard', id: 'evolution', patchPath: join(emptyHome, 'profiles', 'web', 'cordis.patch.yml'), status: 'absent' },
      { base: 'ptc', id: 'evolution-ptc', patchPath: join(emptyHome, 'profiles', 'web', 'cordis.patch.yml'), status: 'absent' },
    ])
  })

  it('is idempotent: a re-run reports "already current" and never rewrites the patch', async () => {
    const home = await tempRoot('dsh-preset-idempotent-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
    await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    const installed = await readFile(patchPath(home), 'utf8')
    const again = await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(presetLine(again.stdout, 'preset-evolution')).toContain('already current')
    expect(await readFile(patchPath(home), 'utf8')).toBe(installed)

    // A hand-edited row is NOT silently replaced: the installer reports it and
    // leaves it alone, exactly like --check-presets. --force is the only writer.
    const tuned = installed.replace('- id: persona', '- id: persona-tuned')
    await writeFile(patchPath(home), tuned)
    const skipped = await runInstaller(home, 'agent', [], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(presetLine(skipped.stdout, 'preset-evolution')).toContain('use --force')
    expect(await readFile(patchPath(home), 'utf8')).toBe(tuned)
    const forced = await runInstaller(home, 'agent', ['--force'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(presetLine(forced.stdout, 'preset-evolution')).not.toContain('use --force')
    expect(await readFile(patchPath(home), 'utf8')).toBe(installed)
  })

  it('dry-run resolves the base and reports the row without writing anything', async () => {
    const home = await tempRoot('dsh-preset-dry-')
    const presetRoot = await presetRootWith(home, { standard: STANDARD_FIXTURE })
    const { stdout } = await runInstaller(home, 'agent', ['--dry-run'], { DSH_AGENT_PRESET_ROOT: presetRoot })
    expect(stdout).toContain('dry-run:  no files were written')
    expect(presetLine(stdout, 'preset-evolution')).toContain(patchPath(home))
    expect(presetLine(stdout, 'preset-evolution')).not.toContain('already current')
    // The profile is not seeded as a side effect: a dry run leaves no home at all.
    expect(existsSync(join(home, 'profiles'))).toBe(false)
    // A dry run against a missing base patch fails like a real one.
    const error = await runInstaller(home, 'agent', ['--base', 'ptc', '--dry-run'], { DSH_AGENT_PRESET_ROOT: presetRoot })
      .then(() => null, (caught: unknown) => caught as { stderr?: string })
    expect(error?.stderr).toContain('ptc.patch.yml')
  })
})

/**
 * The real platform base patch for one base, resolved by walking up from this
 * spec to the bundle that ships the presets — the same shape the installer's
 * ancestor walk uses (`packages/bundle/<name>/presets/<base>.patch.yml`).
 * @param base - the base name.
 * @returns the patch file's absolute path.
 */
function platformBasePatch(base: string): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'packages', 'bundle', 'web-app', 'presets', `${base}.patch.yml`)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`platform base patch for ${base} not found above the spec`)
    dir = parent
  }
}
