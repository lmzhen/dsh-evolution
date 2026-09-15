import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { composePresetComposition, sessionAudited } from '@deepseek-ai/dsh-evolution-core'
import { collectEvolutionBundles, diagnose, renderDoctorText } from '../src/doctor.ts'

const stub = { get: () => undefined }

/** G3-② (B2): the delta and the base table doctor compares against, resolved
 * from the installed family package through the same export a user install uses. */
function familyAsset(asset: string): string {
  return fileURLToPath(import.meta.resolve(`@deepseek-ai/dsh-evolution-agent-preset/${asset}`))
}

/** G3-② (B2): the runtime platform registry stub. It carries the
 * `- id: tool-skill` row the composer injects the 60-char cap onto, so the
 * fixture exercises the shared row-overrides table as well as the composition. */
const PLATFORM_COMPOSITION = [
  '- id: tool-skill',
  "  name: '@deepseek-ai/dsh-skill-catalog'",
  '',
  '- id: persona',
  "  text: 'harness persona'",
  '',
].join('\n')

function presetRegistry(composition: string): { get(name: string): unknown } {
  return { get: (name: string) => name === 'agentPresets' ? { read: async () => composition } : undefined }
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

  it('T-WB2: host-only without a preset dir reports host; with the dir reports layered', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-host-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      expect((await diagnose(stub, { home })).installForm).toBe('host')
      // V26-02 (v25/v26): 'layered' keys on the DELIVERED artifact — a bare
      // empty directory is not a layered install.
      await mkdir(join(home, '.agent-presets', 'evolution'), { recursive: true })
      expect((await diagnose(stub, { home })).installForm).toBe('host')
      await writeFile(join(home, '.agent-presets', 'evolution', 'agent.cordis.yml'), 'rows: []', 'utf8')
      expect((await diagnose(stub, { home })).installForm).toBe('layered')
      // ...and the product name for that layout: the variant form, in which a
      // session on a platform original preset carries no family rows at all.
      expect((await diagnose(stub, { home })).deploymentForm).toBe('variant')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('V27 G6.4: all × a delivered preset dir is flagged without the host bundle; a bare dir is not', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-all-presetdir-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-all'])
      // A bare leftover directory is not an install (same artifact rule as the
      // preset-bundle case above).
      await mkdir(join(home, '.agent-presets', 'evolution'), { recursive: true })
      expect((await diagnose(stub, { home })).conflicts).toEqual([])
      // The delivered preset artifact + `all` double-mounts the four model rows
      // even when evolution-host is absent — the old `full && layered` condition
      // required host and stayed silent for exactly this combination.
      await writeFile(join(home, '.agent-presets', 'evolution', 'agent.cordis.yml'), 'rows: []', 'utf8')
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
      // host + `--base ptc` artifact = layered (the old probe saw only the
      // default `evolution` dir and reported 'host').
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      await mkdir(join(home, '.agent-presets', 'evolution-ptc'), { recursive: true })
      await writeFile(join(home, '.agent-presets', 'evolution-ptc', 'agent.cordis.yml'), 'rows: []', 'utf8')
      const hostReport = await diagnose(stub, { home })
      expect(hostReport.installForm).toBe('layered')
      expect(hostReport.deploymentForm).toBe('variant')
      // ptc artifact with NO bundle = preset-only (used to read as 'none' and
      // the action ladder then recommended installing `all` on top — the
      // exact double-mount this report exists to prevent).
      await rm(join(home, 'profiles'), { recursive: true, force: true })
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
      await mkdir(join(home, '.agent-presets', 'evolution-ptc'), { recursive: true })
      await writeFile(join(home, '.agent-presets', 'evolution-ptc', 'agent.cordis.yml'), 'rows: []', 'utf8')
      expect((await diagnose(stub, { home })).conflicts.some(conflict => conflict.includes('evolution-ptc'))).toBe(true)
      // minimal carries NO family model rows (unsupported in bases.json) — it
      // cannot double-mount, so all + minimal stays healthy.
      await rm(join(home, '.agent-presets', 'evolution-ptc'), { recursive: true, force: true })
      await mkdir(join(home, '.agent-presets', 'evolution-minimal'), { recursive: true })
      await writeFile(join(home, '.agent-presets', 'evolution-minimal', 'agent.cordis.yml'), 'rows: []', 'utf8')
      expect((await diagnose(stub, { home })).conflicts).toEqual([])
      // A FOREIGN preset directory is not a family layered install either.
      await rm(join(home, '.agent-presets', 'evolution-minimal'), { recursive: true, force: true })
      await mkdir(join(home, '.agent-presets', 'some-other-plugin'), { recursive: true })
      await writeFile(join(home, '.agent-presets', 'some-other-plugin', 'agent.cordis.yml'), 'rows: []', 'utf8')
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

  it('V25-07/V24-11: preset bundle × a POPULATED layered preset dir is flagged; a bare empty preset dir is not', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-layered-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-preset'])
      // A bare/empty leftover directory is NOT a layered install — no conflict
      // (V25-07: detection keys on the delivered agent.cordis.yml artifact).
      await mkdir(join(home, '.agent-presets', 'evolution'), { recursive: true })
      expect((await diagnose(stub, { home })).conflicts).toEqual([])
      // The delivered artifact flips it into a real double-mount.
      await writeFile(join(home, '.agent-presets', 'evolution', 'agent.cordis.yml'), 'rows: []', 'utf8')
      const report = await diagnose(stub, { home })
      expect(report.conflicts.some(c => c.includes('layered Evolution preset'))).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
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

  it('OPT-23: a delivered preset dir with NO bundles reports preset-only — and never advises installing all', async () => {
    // V27 G6.4's real state: the host bundle was removed after a layered
    // install, leaving the self-contained delta preset. The old form ladder
    // reported `none` and its advice installed all — the exact
    // all × preset double-mount this report flags.
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-only-'))
    try {
      await mkdir(join(home, '.agent-presets', 'evolution'), { recursive: true })
      await writeFile(join(home, '.agent-presets', 'evolution', 'agent.cordis.yml'), 'rows: []', 'utf8')
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

  it('G3-② (B2): a variant matching a fresh generation is fresh; a hand-edited one DIFFERS and is left untouched', async () => {
    // The variant is an INSTALL-TIME snapshot of the platform composition: the
    // file mounts fine while describing a platform that has moved on, and only a
    // recompute against the live composition can tell the two apart.
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-fresh-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      const delta = readFileSync(familyAsset('agent.cordis.yml'), 'utf8')
      const destination = join(home, '.agent-presets', 'evolution')
      const compositionPath = join(destination, 'agent.cordis.yml')
      await mkdir(destination, { recursive: true })
      await writeFile(compositionPath, composePresetComposition(PLATFORM_COMPOSITION, delta), 'utf8')

      const report = await diagnose(presetRegistry(PLATFORM_COMPOSITION), { home })
      const row = report.presetFreshness.find(entry => entry.base === 'standard')
      expect(row?.destination).toBe(destination)
      expect(row?.status).toBe('fresh')
      expect(report.actions.some(action => action.includes(destination))).toBe(false)
      expect(renderDoctorText(report)).toContain(`${destination}  fresh`)

      // One hand-edited line is the whole failure: the file still mounts, but it
      // no longer describes a generation this platform can produce.
      const edited = `${readFileSync(compositionPath, 'utf8')}# hand edit\n`
      await writeFile(compositionPath, edited, 'utf8')
      const stale = await diagnose(presetRegistry(PLATFORM_COMPOSITION), { home })
      expect(stale.presetFreshness.find(entry => entry.base === 'standard')?.status).toBe('differs')
      expect(stale.actions.some(action => action.includes(destination))).toBe(true)
      // The line a user reads: pinned verbatim, destination included.
      expect(renderDoctorText(stale)).toContain(`preset:   ${destination}  DIFFERS from a fresh generation — it is an install-time snapshot; re-run the installer (/evolution preset install) to regenerate`)
      // READ-ONLY: reporting an install-time snapshot never rewrites it.
      expect(readFileSync(compositionPath, 'utf8')).toBe(edited)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('G3-② (B2): a directory without the composition is absent; an unmounted or failing registry is unknown', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-preset-unknown-'))
    try {
      await makeProfile(home, 'web', ['@lmzhen/dsh-evolution-host'])
      const destination = join(home, '.agent-presets', 'evolution')
      const compositionPath = join(destination, 'agent.cordis.yml')
      await mkdir(destination, { recursive: true })
      // A leftover directory is not an installed variant (the artifact rule the
      // install-form check already uses) and is nothing to act on either.
      const absent = await diagnose(presetRegistry(PLATFORM_COMPOSITION), { home })
      expect(absent.presetFreshness.map(entry => entry.base)).toEqual(expect.arrayContaining(['standard', 'ptc', 'cordis', 'minimal']))
      expect(absent.presetFreshness.find(entry => entry.base === 'standard')?.status).toBe('absent')
      expect(absent.actions.some(action => action.includes(destination))).toBe(false)
      expect(renderDoctorText(absent)).not.toContain(destination)

      await writeFile(compositionPath, 'rows: []\n', 'utf8')
      // No registry mounted: one half of the comparison is missing, so the
      // variant is unknown — never a fake fresh.
      const unmounted = await diagnose(stub, { home })
      const unmountedRow = unmounted.presetFreshness.find(entry => entry.base === 'standard')
      expect(unmountedRow?.status).toBe('unknown')
      expect(unmountedRow?.detail).toContain('registry is not mounted')
      expect(unmounted.actions.some(action => action.includes(destination))).toBe(false)
      expect(renderDoctorText(unmounted)).toContain('could not be recomputed')

      // A registry that fails the read (a preset root it cannot open) degrades
      // the same way instead of reporting the file as clean.
      const failing = { get: (name: string) => name === 'agentPresets' ? { read: async () => { throw new Error('EACCES: unreadable preset root') } } : undefined }
      const failedRow = (await diagnose(failing, { home })).presetFreshness.find(entry => entry.base === 'standard')
      expect(failedRow?.status).toBe('unknown')
      expect(failedRow?.detail).toContain('EACCES: unreadable preset root')
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
  const runtime = (budget: unknown, policy: unknown) => ({
    get: (name: string) => name === 'evolutionMemoryBudget' ? budget : name === 'evolutionPolicy' ? policy : undefined,
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
})

