import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectEvolutionBundles, diagnose, renderDoctorText } from '../src/doctor.ts'

const stub = { get: () => undefined }

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
})
