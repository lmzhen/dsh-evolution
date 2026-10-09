import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { composePresetEntry, mergePresetRow, presetRowId, removePresetRow, sessionAudited } from '@deepseek-ai/dsh-evolution-core'
import { collectEvolutionBundles, diagnose, renderDoctorText } from '../src/doctor.ts'

const stub = { get: () => undefined }

/** The runtime service store, as the two host entry points read it: `/evolution preset install`
 * refuses a base through it and `/evolution doctor` enumerates installable bases through it.
 * `stub` answers undefined for every name — a deployment that provides none of them. */
function serviceStub(...names: string[]): { get: (name: string) => unknown } {
  const present = new Set(names)
  return { get: (name: string): unknown => (present.has(name) ? {} : undefined) }
}

/** G3 (stage 8): a context carrying the two seats the legacy-document segment reads — the
 * platform settings seat (one row's user layer) and the family IO seam over a home whose
 * `settings.yaml` is the only file it can read. */
function legacyStub(home: string, user: Record<string, unknown>): { get(name: string): unknown } {
  const document = join(home, 'settings.yaml')
  return {
    get: (name: string): unknown => name === 'settings'
      ? { describe: (): { ns: string; user: Record<string, unknown> }[] => [{ ns: 'memory-files', user }], update: async (): Promise<void> => {} }
      : name === 'evolutionIo'
        ? { provider: (): { readText(path: string): Promise<string | null> } => ({ readText: async (path: string) => path === document && existsSync(document) ? await readFile(document, 'utf8') : null }) }
        : undefined,
  }
}

/** G3-② (B2): the delta and the base table doctor compares against, resolved
 * from the installed family package through the same export a user install uses. */
function familyAsset(asset: string): string {
  return fileURLToPath(import.meta.resolve(`@deepseek-ai/dsh-evolution-agent-preset/${asset}`))
}

/** G3-② (B2): the platform base preset patch a delivered row composes from — the shape a
 * bundle ships (`packages/bundle/web-app/presets/<base>.patch.yml`): one `insert` entry whose
 * preset row carries the base composition under `config.plugins`. It holds the
 * `- id: tool-skill` row the composer injects the 60-char cap onto, so the fixture exercises
 * the shared row-overrides table as well as the composition. */
const PLATFORM_BASE_PATCH = [
  '- insert:',
  '    - id: preset-standard',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: standard',
  '        plugins:',
  '          - id: tool-skill',
  "            name: '@deepseek-ai/dsh-skill-catalog'",
  '',
  '          - id: persona',
  "            text: 'harness persona'",
  '',
].join('\n')

/** One row of the family base table (evolution-agent/bases.json) — the SAME table
 * `/evolution preset install` takes its row identity from. */
interface BaseRow {
  name: string
  id: string
  display: { name: string; description: string; order: number }
}

const FAMILY_BASES = (JSON.parse(readFileSync(familyAsset('bases.json'), 'utf8')) as { bases: BaseRow[] }).bases

/** One base-table row by base NAME, or a loud fixture error. */
function familyBase(name: string): BaseRow {
  const row = FAMILY_BASES.find(candidate => candidate.name === name)
  if (row === undefined) throw new Error(`fixture: bases.json carries no base named "${name}"`)
  return row
}

/** The profile patch a family row is delivered into (`PROFILE_PATCH_FILENAME`). */
function profilePatch(home: string, profile = 'web'): string {
  return join(home, 'profiles', profile, 'cordis.patch.yml')
}

/** Where the platform base patch of one base lives for a profile: the resolver's own
 * profile-relative candidate (`<profileDir>/node_modules/@deepseek-ai/dsh-web-app/presets/<base>.patch.yml`). */
function platformBasePatch(home: string, base: string, profile = 'web'): string {
  return join(home, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', `${base}.patch.yml`)
}

/**
 * Deliver the 0.2.x preset artifact: ONE `- insert:` row carrying the declarative
 * `@deepseek-ai/dsh-agent-preset` row in the target profile's own patch layer — the file the
 * platform's Web editor saves preset edits to and the doctor reads. The row goes through the
 * SAME core functions the installer applies (`composePresetEntry` + `mergePresetRow`) from the
 * same family rows, so a fixture cannot describe an artifact the installer would never write.
 * @param home - the DSH_HOME whose profile receives the row.
 * @param base - the base NAME from bases.json (`standard` / `ptc` / `cordis` / `minimal`).
 * @param profile - the profile whose patch receives the row; defaults to `web`.
 * @param options - `basePatch: null` withholds the platform base patch the row was composed
 * against (a delivered row outliving the platform tree it describes); a string seeds THAT text;
 * `destination: 'home'` lands the row in the home layer instead of the profile's own patch.
 * @returns the patch path the row landed in.
 */
async function deliverPresetRow(
  home: string,
  base: string,
  profile = 'web',
  options: { basePatch?: string | null; destination?: 'profile' | 'home' } = {},
): Promise<string> {
  const row = familyBase(base)
  if (options.basePatch !== null) {
    const seeded = platformBasePatch(home, base, profile)
    await mkdir(dirname(seeded), { recursive: true })
    await writeFile(seeded, options.basePatch ?? PLATFORM_BASE_PATCH, 'utf8')
  }
  const entry = composePresetEntry(PLATFORM_BASE_PATCH, readFileSync(familyAsset('agent.cordis.yml'), 'utf8'), {
    rowId: presetRowId(row.id),
    id: row.id,
    name: row.display.name,
    description: row.display.description,
    order: row.display.order,
  })
  // The home layer (<home>/cordis.patch.yml) is composed by the platform AFTER the profile's own
  // patch, so a row there mounts identically (S2.8/T4-07).
  const patchPath = options.destination === 'home' ? join(home, 'cordis.patch.yml') : profilePatch(home, profile)
  const current = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  await writeFile(patchPath, mergePresetRow(current, entry, presetRowId(row.id)), 'utf8')
  return patchPath
}

async function makeProfile(home: string, profile: string, bundles: string[]): Promise<void> {
  const dir = join(home, 'profiles', profile)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles } } }), 'utf8')
}

describe('doctor (WB2, 0.3.55)', () => {
  it('T-WB2: classifies the full install form', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-full-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      const report = await diagnose(stub, { home })
      expect(report.installForm).toBe('full')
      // C axis (0.3.77): 'full' is the ATTACH product form — every session
      // carries the family's model rows, which is what the session-scoped gate
      // then resolves per session.
      expect(report.deploymentForm).toBe('attach')
      expect(report.conflicts).toEqual([])
      expect(report.actions.some(action => action.includes('@lmzhen/dsh-evolution-all'))).toBe(false)
      // P0-1 (v11): review is inferred from the bundle (it provides no service
      // key) — a healthy full install must never render review=false.
      expect(report.services.review).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('P0-1 (v11): a host-only install still infers review=true via the bundle', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-review-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      const report = await diagnose(stub, { home })
      expect(report.services.review).toBe(true)
      expect(report.deploymentForm).toBe('host-only')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('T-WB2: host-only without the delivered row reports host; with it reports layered', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-host-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      expect((await diagnose(stub, { home })).installForm).toBe('host')
      // V26-02 (v25/v26): 'layered' keys on the DELIVERED artifact — a profile
      // patch holding no family row (here the platform's own empty-list seed) is
      // not a layered install.
      await writeFile(profilePatch(home), '[]\n', 'utf8')
      expect((await diagnose(stub, { home })).installForm).toBe('host')
      await deliverPresetRow(home, 'standard')
      expect((await diagnose(stub, { home })).installForm).toBe('layered')
      // ...and the product name for that layout: the variant form, in which a
      // session on a platform original preset carries no family rows at all.
      expect((await diagnose(stub, { home })).deploymentForm).toBe('variant')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('V27 G6.4: all × a delivered preset row is flagged without the host bundle; a bare patch is not', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-all-presetdir-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      // A leftover profile patch with no family row is not an install (same
      // artifact rule as the preset-bundle case above).
      await writeFile(profilePatch(home), '[]\n', 'utf8')
      expect((await diagnose(stub, { home })).conflicts).toEqual([])
      // The delivered preset artifact + `all` double-mounts the four model rows
      // even when evolution-host is absent — the old `full && layered` condition
      // required host and stayed silent for exactly this combination.
      await deliverPresetRow(home, 'standard')
      const report = await diagnose(stub, { home })
      expect(report.conflicts.some(conflict => conflict.includes('evolution-all and the layered Evolution preset'))).toBe(true)
      expect(report.actions[0]).toContain('Resolve the conflict first')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S1-F1: a ptc/cordis layered install is detected like the default base, not misread as none', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-ptc-layered-'))
    try {
      // host + the `--base ptc` row = layered (the old probe saw only the
      // default `evolution` row and reported 'host').
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      await deliverPresetRow(home, 'ptc')
      const hostReport = await diagnose(stub, { home })
      expect(hostReport.installForm).toBe('layered')
      expect(hostReport.deploymentForm).toBe('variant')
      // The ptc row with NO evolution bundle = preset-only (used to read as 'none'
      // and the action ladder then recommended installing `all` on top — the exact
      // double-mount this report exists to prevent). The artifact lives in the
      // profile's own patch layer now, so this state is the profile that outlived
      // its bundles rather than a home without a profile.
      await makeProfile(home, 'web', [])
      const onlyReport = await diagnose(stub, { home })
      expect(onlyReport.installForm).toBe('preset-only')
      expect(onlyReport.actions[0]).toContain('double-mounts the model rows')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S1-F1: all × a delivered ptc artifact is flagged; a minimal-base or foreign artifact is not', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-all-ptc-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      // ptc IS a supported family base: the conflict the default id raises
      // must raise here too.
      await deliverPresetRow(home, 'ptc')
      expect((await diagnose(stub, { home })).conflicts.some(conflict => conflict.includes('evolution-ptc'))).toBe(true)
      // minimal carries NO family model rows (unsupported in bases.json) — it
      // cannot double-mount, so all + minimal stays healthy.
      const patchPath = profilePatch(home)
      await writeFile(patchPath, removePresetRow(readFileSync(patchPath, 'utf8'), presetRowId('evolution-ptc')), 'utf8')
      await deliverPresetRow(home, 'minimal')
      expect((await diagnose(stub, { home })).conflicts).toEqual([])
      // A FOREIGN preset row is not a family layered install either.
      await writeFile(patchPath, removePresetRow(readFileSync(patchPath, 'utf8'), presetRowId('evolution-minimal')), 'utf8')
      await writeFile(patchPath, mergePresetRow(
        readFileSync(patchPath, 'utf8'),
        "- insert:\n    - id: preset-some-other-plugin\n      name: '@some/other-plugin'\n",
        'preset-some-other-plugin',
      ), 'utf8')
      expect((await diagnose(stub, { home })).conflicts).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('T-WB2: one-click preset reports preset', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-preset'])
      expect((await diagnose(stub, { home })).installForm).toBe('preset')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('V25-07/V24-11: preset bundle × a POPULATED layered preset row is flagged; a bare patch is not', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-layered-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-preset'])
      // A leftover profile patch with no family row is NOT a layered install — no
      // conflict (V25-07: detection keys on the delivered agent-preset row artifact).
      await writeFile(profilePatch(home), '[]\n', 'utf8')
      expect((await diagnose(stub, { home })).conflicts).toEqual([])
      // The delivered artifact flips it into a real double-mount.
      await deliverPresetRow(home, 'standard')
      const report = await diagnose(stub, { home })
      expect(report.conflicts.some(c => c.includes('layered Evolution preset'))).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S5.10 (audit P2-28): the all/standalone × layered-preset warn names the double-instance and shadowing semantics explicitly', async () => {
    // Previously only INSTALL.md carried this warning: the four model rows AND
    // the systemPrompt sections double-instance across the profile and preset
    // layers, and the preset loader fails SOFT (shadowing semantics take the
    // nearest layer) — so the doctor row must say what actually happens, not
    // just "double-mount".
    const makeCase = async (bundle: string): Promise<void> => {
      const home = await mkdtemp(join(tmpdir(), 'doctor-shadow-warn-'))
      try {
        await makeProfile(home, 'web', [bundle])
        await writeFile(profilePatch(home), '[]\n', 'utf8')
        await deliverPresetRow(home, 'standard')
        const report = await diagnose(stub, { home })
        const row = report.conflicts.find(conflict => conflict.includes('layered Evolution preset'))
        expect(row, bundle).toBeDefined()
        expect(row, bundle).toContain('systemPrompt sections')
        expect(row, bundle).toContain('shadowing semantics take the nearest layer')
        expect(row, bundle).toContain('Keep ONE')
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    }
    await makeCase('@lmzhen/dsh-evolution-all')
    await makeCase('@lmzhen/dsh-evolution-preset')
  })

  it('T-WB2: all+host double install is flagged with a choose-one action', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-conflict-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all', '@lmzhen/dsh-evolution-host'])
      const report = await diagnose(stub, { home })
      expect(report.conflicts.length).toBeGreaterThan(0)
      expect(report.actions.join('\n')).toContain('keep exactly one')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('T-WB2: an invalid DSH_EVOLUTION_SESSION_QUERY surfaces as an env issue with a fix', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-env-'))
    const previous = process.env.DSH_EVOLUTION_SESSION_QUERY
    process.env.DSH_EVOLUTION_SESSION_QUERY = '1'
    try {
      const report = await diagnose(stub, { home })
      expect(report.envIssues.join('\n')).toContain('not one of startup|first-search|never')
      expect(report.actions.join('\n')).toContain('DSH_EVOLUTION_*')
    } finally {
      if (previous === undefined) delete process.env.DSH_EVOLUTION_SESSION_QUERY
      else process.env.DSH_EVOLUTION_SESSION_QUERY = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('reports the legacy settings document, and what is still unmigrated (G3)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-legacy-'))
    try {
      await writeFile(join(home, 'settings.yaml'), 'evolution-memory:\n  memoryCharLimit: 2200\nui-chat:\n  transcriptView: standard\n', 'utf8')
      const report = await diagnose(legacyStub(home, {}), { home })
      expect(report.legacy.state).toBe('pending')
      expect(report.legacy.pending).toEqual(['memory-files.memoryChars'])
      const text = renderDoctorText(report)
      expect(text).toContain('legacy settings: 1 family value(s) still on')
      expect(text).toContain('/evolution migrate moves them')
      expect(report.actions.join('\n')).toContain('/evolution migrate')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('reports the legacy document as settled once every value sits on its row (G3)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-legacy-done-'))
    try {
      await writeFile(join(home, 'settings.yaml'), 'evolution-memory:\n  memoryCharLimit: 2200\n', 'utf8')
      const report = await diagnose(legacyStub(home, { memoryChars: 2200 }), { home })
      expect(report.legacy.state).toBe('migrated')
      expect(renderDoctorText(report)).toContain('every family value sits on its row')
      expect(report.actions.join('\n')).not.toContain('/evolution migrate')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('reports a document without a family section, and no document at all (G3)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-legacy-none-'))
    try {
      await writeFile(join(home, 'settings.yaml'), 'ui-chat:\n  transcriptView: standard\n', 'utf8')
      const none = await diagnose(legacyStub(home, {}), { home })
      expect(none.legacy.state).toBe('none')
      expect(renderDoctorText(none)).toContain('carries no family section')
      await rm(join(home, 'settings.yaml'), { force: true })
      expect((await diagnose(legacyStub(home, {}), { home })).legacy.state).toBe('absent')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('reports the legacy document as unknown when the settings seat or the IO seam is absent (G3)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-legacy-no-seat-'))
    try {
      expect((await diagnose(stub, { home })).legacy.state).toBe('unavailable')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
  it('G5: takes the install form and the review row from the platform surfaces (G5)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-g5-'))
    try {
      const view = {
        get: (name: string): unknown => name === 'pluginManager'
          ? {
            listBundles: (): unknown[] => [
              { name: '@lmzhen/dsh-evolution-all', enabled: true, installed: false, optional: false, removable: true, rows: [], overrides: [] },
              { name: '@lmzhen/dsh-evolution-host', enabled: false, installed: true, optional: false, removable: true, rows: [], overrides: [] },
            ],
            listPlugins: (): unknown[] => [{ entryId: 'include:evolution-review', enabled: true, fiberPhase: 'active' }],
          }
          : undefined,
      }
      const report = await diagnose(view, { home })
      expect(report.installForm).toBe('full')
      expect(report.formSource).toBe('platform')
      expect(report.runtimeBundles).toEqual(['@lmzhen/dsh-evolution-all'])
      // Installed but NOT selected: the plugin page lists it, this runtime mounts nothing of it.
      expect(report.dormantBundles).toEqual(['@lmzhen/dsh-evolution-host'])
      expect(report.serviceSource).toBe('platform')
      expect(report.services.review).toBe(true)
      // The cross-profile aggregate answers a DIFFERENT question and stays empty on this home.
      expect(report.bundles).toEqual([])
      const text = renderDoctorText(report)
      expect(text).toContain('runtime bundles (this profile): @lmzhen/dsh-evolution-all')
      expect(text).toContain('(the live row, this runtime)')
      expect(text).toContain('installed but not selected: @lmzhen/dsh-evolution-host')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('G5: a family row the platform reports as off is not a mounted review row', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-g5-off-'))
    try {
      const view = {
        get: (name: string): unknown => name === 'pluginManager'
          ? { listPlugins: (): unknown[] => [{ entryId: 'include:evolution-review', enabled: false }] }
          : undefined,
      }
      const report = await diagnose(view, { home })
      expect(report.serviceSource).toBe('platform')
      expect(report.services.review).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('G5: reports the platform\'s broken preset, and not the base rows every preset shares', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-g5-presets-'))
    try {
      const view = {
        get: (name: string): unknown => name === 'pluginInventory'
          ? {
            list: async (): Promise<unknown> => ({
              entries: [],
              agentPresets: [
                { id: 'standard', rows: [{ entryId: 'persona', moduleName: 'x', enabled: true }] },
                { id: 'evolution', rows: [{ entryId: 'persona', moduleName: 'x', enabled: true }, { entryId: 'tool-memory', moduleName: 'y', enabled: true }, { entryId: null, moduleName: 'z' }] },
                { id: 'ptc', broken: 'missing base', rows: [] },
              ],
            }),
          }
          : undefined,
      }
      const report = await diagnose(view, { home })
      // `persona` is declared by two presets — measured on a real deployment, EVERY preset
      // composes the same base rows, so that is the healthy steady state and not a finding.
      expect(report.presetIssues).toHaveLength(1)
      const text = renderDoctorText(report)
      expect(text).toContain('agent presets:')
      expect(text).toContain('is BROKEN (missing base)')
      expect(text).not.toContain('declared by')
      expect(report.actions.join('\n')).toContain('agent-preset finding')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('G5: without the platform surfaces the report says unknown instead of claiming none', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-g5-absent-'))
    try {
      const report = await diagnose(stub, { home })
      expect(report.runtimeBundles).toBeNull()
      expect(report.formSource).toBe('aggregate')
      expect(report.serviceSource).toBe('bundles')
      expect(report.presetIssues).toEqual([])
      expect(renderDoctorText(report)).toContain('runtime bundles: unknown — the platform bundle surface')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
  it('renders a human-readable report that ends with next steps', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-render-'))
    try {
      const text = renderDoctorText(await diagnose(stub, { home }))
      expect(text).toContain('install form: none')
      expect(text).toContain('next steps:')
      expect(text).toContain('dsh plugin --profile web add @lmzhen/dsh-evolution-all')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('collects evolution bundles across ALL profiles', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-multi-'))
    try {
      await makeProfile(home, 'p1', ['@lmzhen/dsh-evolution-all'])
      await makeProfile(home, 'p2', ['@lmzhen/dsh-evolution-host'])
      const bundles = collectEvolutionBundles(home)
      expect(bundles).toContain('@lmzhen/dsh-evolution-all')
      expect(bundles).toContain('@lmzhen/dsh-evolution-host')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('v34 INST-01: a corrupt profile manifest is REPORTED, never read as "no bundles"', async () => {
    // The corruption INST-01 exists to prevent: a truncated manifest makes the
    // profile's bundle rows UNKNOWN. Swallowing the parse error reported
    // `bundles: (none)` and let the preset-install mutual-exclusion gate
    // proceed with a double-mounting install.
    const home = await mkdtemp(join(tmpdir(), 'doctor-corrupt-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"dsh":{"profile":{"bundles":["@lmzhen/dsh-evol', 'utf8')
      const seen: unknown[] = []
      const bundles = collectEvolutionBundles(home, (error) => { seen.push(error) })
      // The unreadable profile contributes no rows, but the failure is loud.
      expect(bundles).toEqual([])
      expect(seen).toHaveLength(1)
      const report = await diagnose(stub, { home })
      expect(report.conflicts.some(conflict => conflict.includes('a profile manifest could not be read or parsed'))).toBe(true)
      // OPT-22: the DEGRADED detail alone must NOT trigger the uninstall
      // advice — there is no bundle conflict here, and "keep exactly one of
      // …" sent operators to uninstall bundles they may not have. The advice
      // is reserved for real double-mount rows; the degraded detail stays in
      // the report for visibility.
      expect(report.actions.some(action => action.includes('Resolve the conflict first'))).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('OPT-23: a delivered preset row with NO bundles reports preset-only — and never advises installing all', async () => {
    // V27 G6.4's real state: the host bundle was removed after a layered
    // install, leaving the self-contained delta preset row in the profile patch.
    // The old form ladder reported `none` and its advice installed all — the exact
    // all × preset double-mount this report flags.
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-only-'))
    try {
      await makeProfile(home, 'web', [])
      await deliverPresetRow(home, 'standard')
      const report = await diagnose(stub, { home })
      expect(report.installForm).toBe('preset-only')
      expect(report.actions.some(action => action.includes('@lmzhen/dsh-evolution-all'))).toBe(false)
      expect(report.actions.some(action => action.includes('@lmzhen/dsh-evolution-host'))).toBe(true)
      expect(report.actions.some(action => action.includes('double-mount'))).toBe(true)
      // A plain 'none' install (nothing anywhere) keeps the install-all advice.
      const empty = await mkdtemp(join(tmpdir(), 'doctor-none-'))
      try {
        const noneReport = await diagnose(stub, { home: empty })
        expect(noneReport.installForm).toBe('none')
        expect(noneReport.actions.some(action => action.includes('@lmzhen/dsh-evolution-all'))).toBe(true)
      } finally {
        await rm(empty, { recursive: true, force: true })
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
  it('S0.2 (v37 P0-1): reports memory entries carrying the platform template syntax', async () => {
    // The platform interpolates `{{name}}` in every prompt-context text and throws
    // on an unknown reference, so on a build without the render-time neutralization
    // one such entry bricks every later turn. Doctor surfaces it (read-only) with a
    // fix instruction — an older running process cannot be repaired from inside the
    // session it broke.
    const home = await mkdtemp(join(tmpdir(), 'doctor-memory-'))
    try {
      await mkdir(join(home, 'memories'), { recursive: true })
      await writeFile(join(home, 'memories', 'MEMORY.md'), 'Deploy template: {{APP_NAME}}\n', 'utf8')
      await writeFile(join(home, 'memories', 'USER.md'), 'plain profile note\n', 'utf8')
      const report = await diagnose(stub, { home })
      expect(report.memoryIssues).toHaveLength(1)
      expect(report.memoryIssues[0]).toContain('MEMORY.md')
      expect(renderDoctorText(report)).toContain('memory:')
      expect(report.actions.some(action => action.includes('Rewrite the memory entries'))).toBe(true)
      // A clean home reports nothing and adds no action.
      const clean = await mkdtemp(join(tmpdir(), 'doctor-memory-clean-'))
      try {
        await mkdir(join(clean, 'memories'), { recursive: true })
        await writeFile(join(clean, 'memories', 'MEMORY.md'), 'nothing to see\n', 'utf8')
        const cleanReport = await diagnose(stub, { home: clean })
        expect(cleanReport.memoryIssues).toEqual([])
        expect(cleanReport.actions.some(action => action.includes('Rewrite the memory entries'))).toBe(false)
      } finally {
        await rm(clean, { recursive: true, force: true })
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
  it('S2.1 (v37 P1-3): the platform-owned profiles/node_modules is not a profile', async () => {
    // `app-boot` creates `$DSH_HOME/profiles/node_modules` on every launch and it
    // never holds a manifest. Before S2.1 the enumeration reported ENOENT as a torn
    // profile, so the preset-install exclusion gate refused on EVERY healthy install
    // and doctor printed a fake DEGRADED conflict naming a platform directory.
    const home = await mkdtemp(join(tmpdir(), 'doctor-node-modules-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      await mkdir(join(home, 'profiles', 'node_modules'), { recursive: true })
      await mkdir(join(home, 'profiles', '.hidden'), { recursive: true })
      const report = await diagnose(stub, { home })
      expect(report.installForm).toBe('full')
      expect(report.conflicts).toEqual([])
      // The preset-install gate rethrows this callback's error — it must not throw.
      expect(() => collectEvolutionBundles(home, (error) => { throw error })).not.toThrow()
      expect(collectEvolutionBundles(home)).toEqual(['@lmzhen/dsh-evolution-all'])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
    // A genuinely unreadable manifest still fails closed (the INST-01 contract).
    const torn = await mkdtemp(join(tmpdir(), 'doctor-torn-'))
    try {
      const dir = join(torn, 'profiles', 'web')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'package.json'), '{ not json', 'utf8')
      expect(() => collectEvolutionBundles(torn, (error) => { throw error })).toThrow()
    } finally {
      await rm(torn, { recursive: true, force: true })
    }
  })

  it('S2.1 (v37 P2-19): a DEGRADED read never produces the install-all advice', async () => {
    // The fail-open INST-01 exists to prevent: a bundle row nobody could read
    // reads as "no bundles", so the ladder advised adding `all` to a deployment
    // that already carries it. Unreadable data must refuse to advise at all.
    const home = await mkdtemp(join(tmpdir(), 'doctor-degraded-manifest-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"dsh":{"profile":{"bundles":["@lmzhen/dsh-evol', 'utf8')
      const report = await diagnose(stub, { home })
      expect(report.conflicts.some(row => row.includes('DEGRADED'))).toBe(true)
      expect(report.actions.some(action => action.includes('@lmzhen/dsh-evolution-all'))).toBe(false)
      expect(report.actions.some(action => action.includes('Install the default full bundle'))).toBe(false)
      expect(report.actions.join('\n')).toContain('/evolution doctor')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
    // The other degraded scope: `profiles` is a FILE, so enumeration itself fails.
    const fileHome = await mkdtemp(join(tmpdir(), 'doctor-degraded-dir-'))
    try {
      await writeFile(join(fileHome, 'profiles'), 'not a directory', 'utf8')
      const report = await diagnose(stub, { home: fileHome })
      expect(report.conflicts.some(row => row.includes('DEGRADED'))).toBe(true)
      expect(report.actions.some(action => action.includes('@lmzhen/dsh-evolution-all'))).toBe(false)
      expect(report.actions.join('\n')).toContain('/evolution doctor')
    } finally {
      await rm(fileHome, { recursive: true, force: true })
    }
    // Control: nothing to read is NOT degraded — the healthy empty home keeps
    // its install advice, so the guard above cannot pass by suppressing it always.
    const empty = await mkdtemp(join(tmpdir(), 'doctor-undegraded-'))
    try {
      const report = await diagnose(stub, { home: empty })
      expect(report.conflicts).toEqual([])
      expect(report.actions.some(action => action.includes('@lmzhen/dsh-evolution-all'))).toBe(true)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('G3-② (B2): a row matching a fresh generation is fresh; a hand-edited one DIFFERS and is left untouched', async () => {
    // The row is an INSTALL-TIME snapshot of the platform composition: it mounts
    // fine while describing a platform that has moved on, and only a recompute
    // against the live platform base patch can tell the two apart.
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-fresh-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      const patchPath = await deliverPresetRow(home, 'standard')

      const report = await diagnose(stub, { home })
      const row = report.presetFreshness.find(entry => entry.base === 'standard')
      expect(row?.destination).toBe(patchPath)
      expect(row?.status).toBe('fresh')
      expect(report.actions.some(action => action.includes(patchPath))).toBe(false)
      expect(renderDoctorText(report)).toContain(`${patchPath}  fresh`)

      // One hand-edited line is the whole failure: the row still mounts, but it
      // no longer describes a generation this platform can produce.
      const edited = `${readFileSync(patchPath, 'utf8')}# hand edit\n`
      await writeFile(patchPath, edited, 'utf8')
      const stale = await diagnose(stub, { home })
      expect(stale.presetFreshness.find(entry => entry.base === 'standard')?.status).toBe('differs')
      expect(stale.actions.some(action => action.includes(patchPath))).toBe(true)
      // The line a user reads: pinned verbatim, destination included.
      expect(renderDoctorText(stale)).toContain(`preset:   standard → ${patchPath}  DIFFERS from a fresh generation — it is an install-time snapshot; re-run the installer (/evolution preset install) to regenerate`)
      // READ-ONLY: reporting an install-time snapshot never rewrites it.
      expect(readFileSync(patchPath, 'utf8')).toBe(edited)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('G3-② (B2): a patch without the row is absent; an unresolvable or malformed platform base is unknown', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-unknown-'))
    try {
      // The web-app bundle is mounted AND the runtime provides the service it brings
      // (`dynamicCordisRunner`), so every SUPPORTED base is enumerated: cordis needs both
      // halves (`baseRefusalReason` over `ctx.get`), and minimal is skipped as
      // registered-unsupported (it carries no family model rows to compare).
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host', '@deepseek-ai/dsh-web-app'])
      const deployed = serviceStub('dynamicCordisRunner')
      const patchPath = profilePatch(home)
      // A profile patch without the row is not an installed variant (the artifact
      // rule the install-form check already uses) and is nothing to act on either.
      const absent = await diagnose(deployed, { home })
      expect(absent.presetFreshness.map(entry => entry.base)).toEqual(expect.arrayContaining(['standard', 'ptc', 'cordis']))
      expect(absent.presetFreshness.find(entry => entry.base === 'standard')?.status).toBe('absent')
      expect(absent.actions.some(action => action.includes(patchPath))).toBe(false)
      expect(renderDoctorText(absent)).not.toContain(patchPath)

      // The row is delivered, but the platform base patch it describes is not on
      // disk (the desktop shape: the platform packages live inside app.asar) — one
      // half of the comparison is missing, so the row is unknown, never a fake fresh.
      const root = await mkdtemp(join(tmpdir(), 'doctor-preset-root-'))
      const previousRoot = process.env.DSH_AGENT_PRESET_ROOT
      process.env.DSH_AGENT_PRESET_ROOT = root
      try {
        await deliverPresetRow(home, 'standard', 'web', { basePatch: null })
        const unmounted = await diagnose(deployed, { home })
        const unmountedRow = unmounted.presetFreshness.find(entry => entry.base === 'standard')
        expect(unmountedRow?.status).toBe('unknown')
        expect(unmountedRow?.detail).toContain('standard.patch.yml does not exist')
        expect(unmounted.actions.some(action => action.includes(patchPath))).toBe(false)
        expect(renderDoctorText(unmounted)).toContain('could not be recomputed')
      } finally {
        if (previousRoot === undefined) delete process.env.DSH_AGENT_PRESET_ROOT
        else process.env.DSH_AGENT_PRESET_ROOT = previousRoot
        await rm(root, { recursive: true, force: true })
      }

      // A platform base patch that exists but cannot produce a composition (no
      // `plugins:` list) degrades the same way instead of reporting the row as clean.
      const malformed = platformBasePatch(home, 'standard')
      await mkdir(dirname(malformed), { recursive: true })
      await writeFile(malformed, '- insert:\n    - id: preset-standard\n', 'utf8')
      const failedRow = (await diagnose(deployed, { home })).presetFreshness.find(entry => entry.base === 'standard')
      expect(failedRow?.status).toBe('unknown')
      expect(failedRow?.detail).toContain('carries no `plugins:` list')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S2.8 (T4-06): the doctor asks the runtime whether a base is installable, exactly as the write entry does', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-base-service-'))
    try {
      // A bundle row is not the service: a profile that mounts `@deepseek-ai/dsh-web-app` while
      // the service's own row is disabled installs nothing (the overlay shape). The freshness
      // probe must therefore not enumerate the cordis base as installable while
      // `/evolution preset install --base cordis` refuses it by name.
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host', '@deepseek-ai/dsh-web-app'])
      const withoutService = await diagnose(stub, { home })
      expect(withoutService.presetFreshness.map(entry => entry.base)).not.toContain('cordis')
      expect(withoutService.presetFreshness.map(entry => entry.base)).toEqual(expect.arrayContaining(['standard', 'ptc']))
      // With the service present — the ordinary web-app deployment — the same base is enumerated,
      // so the judgement narrowed rather than dropping the base from the report.
      const withService = await diagnose(serviceStub('dynamicCordisRunner'), { home })
      expect(withService.presetFreshness.map(entry => entry.base)).toContain('cordis')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S2.8 (T4-07): a preset row in the HOME layer is an install, not a missing one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-home-layer-'))
    try {
      // The platform composes the home layer AFTER the profile's own patch
      // (`readProfilePatches`), so a row moved there mounts identically. Reading only
      // `profiles/*/` reported 'host', fired no conflict row, and advised installing
      // `evolution-all` on top of the mounted preset.
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      await deliverPresetRow(home, 'standard', 'web', { destination: 'home' })
      const report = await diagnose(stub, { home })
      expect(report.installForm).toBe('layered')
      expect(report.deploymentForm).toBe('variant')
      // The same detection feeds every layered conflict row: stacking `all` on that
      // home-layer install is the double-mount the doctor exists to prevent.
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host', '@lmzhen/dsh-evolution-all'])
      const stacked = await diagnose(stub, { home })
      expect(stacked.conflicts.some(conflict => conflict.includes('evolution-all and the layered Evolution preset'))).toBe(true)
      expect(stacked.actions[0]).toContain('Resolve the conflict first')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S0-4 (v43 G-1 / J-1): reconciles the scoped rows with the probe witness and calls never-hit a finding', async () => {
    // Before S0-4 the two halves never met: the bundle turns the session scoping
    // on for evolution-review and skill-usage, and both then answered false for
    // every session with nothing in the log and nothing in this report.
    const gate = (seen: { name: string } | undefined): Context => {
      const ctx = new Context()
      // The host-only shape returns nothing; a session that carries the family's
      // model rows returns the definition.
      ctx.provide('tools', { get: (name: string) => seen !== undefined && name === seen.name ? seen : undefined })
      return ctx
    }
    const home = await mkdtemp(join(tmpdir(), 'doctor-scoped-probe-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      // No session event has reached the gate in this process: the rows are
      // mounted and the verdict claims nothing yet.
      const idle = await diagnose(stub, { home })
      expect(idle.scopedProbe).toEqual({ rows: ['evolution-review', 'skill-usage'], verdict: 'idle', hits: 0, misses: 0 })
      expect(renderDoctorText(idle)).toContain('scoped rows: evolution-review=on/skill-usage=on, probe=idle')

      // One scoped rejection with no match ever: the gate is wired, and its
      // answer is "no session is a family session" — the host-only deployment.
      expect(sessionAudited(gate(undefined), 's1', true)).toBe(false)
      const never = await diagnose(stub, { home })
      expect(never.scopedProbe.verdict).toBe('never-hit')
      expect(never.scopedProbe.misses).toBe(1)
      const text = renderDoctorText(never)
      expect(text).toContain('scoped rows: evolution-review=on/skill-usage=on, probe=never-hit')
      expect(text).toContain('HOST-ONLY installs reach this')
      // Both readings travel with the finding: the host-only form can never
      // match, the variant form matches as soon as the preset session runs.
      const advice = never.actions.join('\n')
      expect(advice).toContain('HOST-ONLY install')
      expect(advice).toContain('VARIANT install')

      // A session that DOES carry the tools clears the finding.
      expect(sessionAudited(gate({ name: 'memory' }), 's2', true)).toBe(true)
      const hit = await diagnose(stub, { home })
      expect(hit.scopedProbe.verdict).toBe('hit')
      expect(hit.actions.join('\n')).not.toContain('HOST-ONLY install')
      expect(renderDoctorText(hit)).toContain('probe=hit')
    } finally {
      await rm(home, { recursive: true, force: true })
    }

    // Control: a home with no bundle mounts no scoped row — there is no gate to
    // reconcile, and the never-hit finding must not appear for it.
    const none = await mkdtemp(join(tmpdir(), 'doctor-scoped-none-'))
    try {
      const report = await diagnose(stub, { home: none })
      expect(report.scopedProbe.rows).toEqual([])
      expect(report.actions.join('\n')).not.toContain('HOST-ONLY install')
      expect(renderDoctorText(report)).toContain('scoped rows: (none mounted)')
    } finally {
      await rm(none, { recursive: true, force: true })
    }

    // Control: a DEGRADED bundle read leaves the row set UNDECIDABLE — an
    // unreadable manifest is not evidence that no bundle is installed.
    const torn = await mkdtemp(join(tmpdir(), 'doctor-scoped-degraded-'))
    try {
      await makeProfile(torn, 'web', ['@lmzhen/dsh-evolution-host'])
      await writeFile(join(torn, 'profiles', 'web', 'package.json'), '{"dsh":{"profile":{"bundles":["@lmzhen/dsh-evol', 'utf8')
      const report = await diagnose(stub, { home: torn })
      expect(report.scopedProbe.rows).toBeNull()
      expect(renderDoctorText(report)).toContain('scoped rows: (undecidable)')
    } finally {
      await rm(torn, { recursive: true, force: true })
    }
  })
})

describe('S2-12③ (FLOW5-4): the memory budget\u2019s two configuration surfaces', () => {
  /** The runtime view doctor reads: memory-files\u2019 published budget + the policy. */
  const runtime = (budget: unknown, policy: unknown, listSessions?: () => unknown) => ({
    get: (name: string) => {
      if (name === 'evolutionMemoryBudget') return budget
      if (name === 'evolutionPolicy') return policy
      if (name === 'sessionQuery' && listSessions !== undefined) return { listSessions: async () => listSessions() }
      return undefined
    },
  })

  it('flags a store/policy disagreement as a doctor finding', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-budget-'))
    try {
      const report = await diagnose(runtime(
        { memoryCharLimit: 5000, userCharLimit: 1375, memorySource: 'config', userSource: 'policy' },
        { get: () => ({ memoryChars: 2200, userChars: 1375 }) },
      ), { home })
      // The review plans against memoryChars=2200 while the store enforces 5000:
      // an explicit contradiction (or a row mounted before the policy existed).
      expect(report.budgetIssues).toHaveLength(1)
      expect(report.budgetIssues[0]).toContain('memoryCharLimit=5000')
      expect(report.budgetIssues[0]).toContain('memoryChars=2200')
      expect(report.actions.some(action => action.includes('Align the memory budget'))).toBe(true)
      const text = renderDoctorText(report)
      expect(text).toContain('memory budget:')
      expect(text).toContain('source: config')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S4 review R-1: a WEDGED probe is a finding, not a hang', async () => {
    // Source-first review finding: the probe awaited the very path a concurrent
    // writer stalls, so /evolution doctor could hang on the state it reports.
    vi.useFakeTimers()
    const home = await mkdtemp(join(tmpdir(), 'doctor-wedged-'))
    try {
      const reportPromise = diagnose(runtime(undefined, undefined, () => new Promise(() => {})), { home })
      // Let the probe register its bound, then fire it (fs IO resolves on the real
      // event loop, so interleave the advances).
      for (let step = 0; step < 3; step += 1) await vi.advanceTimersByTimeAsync(2_000)
      const report = await reportPromise
      expect(report.queryIssues).toHaveLength(2)
      expect(report.queryIssues[0]).toContain('did not answer within 5000ms')
      expect(report.queryIssues[1]).toContain('isolate the offending session')
      expect(renderDoctorText(report)).toContain('session search:')
    } finally {
      vi.useRealTimers()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('R-2 (source-first review): a probe that THROWS synchronously is a finding, not a crash', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-syncthrow-'))
    try {
      // A mounted-but-broken service can throw before it ever returns a promise;
      // the probe must capture that exactly like a rejection (the eager
      // `Promise.resolve(service.list())` form let it escape and crash doctor).
      // A TRUE synchronous throw: the service object's method itself throws,
      // before any promise exists (the async-arrow stub form would only produce a
      // rejection, which the eager `Promise.resolve(service.list())` shape already
      // handled — see the discriminating check in the commit).
      const throwingView = {
        get: (name: string) => name === 'sessionQuery'
          ? { listSessions: (): never => { throw new Error('session-query service is not initialised') } }
          : undefined,
      }
      const report = await diagnose(throwingView, { home })
      expect(report.queryIssues).toHaveLength(2)
      expect(report.queryIssues[0]).toContain('session-query service is not initialised')
      expect(renderDoctorText(report)).toContain('session search:')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S4 (P-1/P-2): a degraded session-query corpus is reported with the isolation recipe', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-query-'))
    try {
      // The platform folds both platform gaps into this one failure; doctor's job
      // is to surface it verbatim next to what an operator can actually do.
      const degraded = await diagnose(runtime(undefined, undefined, () => {
        throw new Error('session-search persistence observation did not stabilize after one retry')
      }), { home })
      expect(degraded.queryIssues).toHaveLength(2)
      expect(degraded.queryIssues[0]).toContain('did not stabilize after one retry')
      expect(degraded.queryIssues[1]).toContain('isolate the offending session')
      expect(degraded.actions.some(action => action.includes('Session search is degraded'))).toBe(true)
      const text = renderDoctorText(degraded)
      expect(text).toContain('session search:')
      // A healthy corpus (and an absent service) stay silent.
      const healthy = await diagnose(runtime(undefined, undefined, () => []), { home })
      expect(healthy.queryIssues).toEqual([])
      expect(renderDoctorText(healthy)).not.toContain('session search:')
      expect((await diagnose(stub, { home })).queryIssues).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('says nothing when the surfaces agree, or when one of them is absent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-budget-ok-'))
    try {
      const agree = await diagnose(runtime(
        { memoryCharLimit: 2200, userCharLimit: 1375, memorySource: 'policy', userSource: 'policy' },
        { get: () => ({ memoryChars: 2200, userChars: 1375 }) },
      ), { home })
      expect(agree.budgetIssues).toEqual([])
      expect(renderDoctorText(agree)).not.toContain('memory budget:')
      // No memory-files row mounted (the plain stub has no services at all):
      // there is nothing to compare, so this is not a finding.
      expect((await diagnose(stub, { home })).budgetIssues).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S4.3: reports the three parameter-surface divergences', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-params-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      // G5: both layers come from the platform's config editor, and the live rows from its
      // plugin manager — the family no longer derives either one from the settings seat.
      const view = {
        get: (name: string): unknown => name === 'configEditor'
          ? { configuration: (): unknown[] => [{ entry: { options: { id: 'evolution-review' } }, inherited: {}, override: { reviewSkillInterval: 30, skillInterval: 5 } }] }
          : name === 'pluginManager'
            ? { listPlugins: (): unknown[] => [{ entryId: 'include:evolution-review', enabled: true }] }
            : undefined,
      }
      const report = await diagnose(view, { home })
      expect(report.paramIssues.some(line => line.startsWith('user override: evolution-review sets 2 parameter(s)'))).toBe(true)
      expect(report.paramIssues.some(line => line.includes('deprecated name: evolution-review still writes "skillInterval" — write "reviewSkillInterval"'))).toBe(true)
      expect(report.paramIssues.some(line => line.includes('declared user-writable but unreachable here:'))).toBe(true)
      expect(report.actions.some(action => action.includes('/evolution params shows every row'))).toBe(true)
      const text = renderDoctorText(report)
      expect(text).toContain('parameters:')
      expect(text).toContain('! user override: evolution-review')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('S4.3/G5: a missing platform surface is a named finding, never silence', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-params-none-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      // No configuration surface at all: the section says so instead of rendering as silence.
      const absent = await diagnose(stub, { home })
      expect(absent.paramIssues).toHaveLength(1)
      expect(absent.paramIssues[0]).toContain('configEditor.configuration')
      expect(absent.paramIssues[0]).toContain('NOT checked')
      expect(renderDoctorText(absent)).toContain('parameters:')
      // The row surface is a second, separate fact: the reachability half cannot run without it.
      const noRows = await diagnose({ get: (name: string) => name === 'configEditor' ? { configuration: (): unknown[] => [] } : undefined }, { home })
      expect(noRows.paramIssues).toHaveLength(1)
      expect(noRows.paramIssues[0]).toContain('listPlugins')
      expect(noRows.paramIssues[0]).toContain('NOT checked')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})

