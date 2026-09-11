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
})
