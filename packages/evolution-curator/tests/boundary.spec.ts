import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
// G4: the idleness gate reads the family's session projection, so the spec mounts the registry
// the platform's base bundle mounts (a real host always has it).
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import EvolutionCurator from '../src/index.ts'
import { evolutionHome } from '@deepseek-ai/dsh-evolution-core'
import { tempHome } from '../../test-support/temp-home.ts'

// v21 (T-8): some tests restore DSH_HOME only on the success path — one
// failing assertion used to leak a temp-dir DSH_HOME into later tests in the
// worker. Restore after EVERY test regardless of outcome.
const REAL_DSH_HOME = process.env.DSH_HOME
afterEach(() => {
  if (REAL_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = REAL_DSH_HOME
})

/** The config fields this spec drives — the deployment-facing shape (G1 §8.2): plain values. */
interface SpecConfig {
  enabled?: boolean
  root?: string
  intervalHours?: number
  staleAfterDays?: number
  archiveAfterDays?: number
  minIdleHours?: number
  minIdleFailOpen?: boolean
  llmReview?: boolean
  autoStart?: boolean
}

async function mount(_home: string, config: SpecConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24, ...config })
  return ctx
}

describe('evolution-curator boundaries', () => {
  it('D2: a custom config.root points the SkillLibrary at the custom tree (0.3.58)', async () => {
    const home = await tempHome('dsh-curator-root-')
    const customRoot = join(home, 'custom-skills')
    const ctx = await mount(home, { root: customRoot })
    expect(ctx.evolutionCurator.skills.root).toBe(customRoot)
    // Default (root omitted): resolveSkillsRoot falls back to $DSH_HOME/skills.
    const defaultCtx = await mount(home)
    expect(defaultCtx.evolutionCurator.skills.root).toBe(join(home, 'skills'))
  })

  it('skips an automatic run while a session is recently active', async () => {
    const home = await tempHome('dsh-curator-idle-')
    const ctx = await mount(home, { minIdleHours: 1 })
    // v32 TEST-02 (CUR-04): a stateful agents stub - the FIRST
    // recentSessionActive call (pre-run gate) sees an idle session so the run
    // PROCEEDS past seeding; the SECOND call (the commit-boundary re-check)
    // sees an active session, so the run skips AND persists the seeded
    // baseline (CUR-04).
    // A minimal state service so the run is STATEFUL (the stateless first-run
    // deferral would otherwise consume this test's boundary).
    ctx.provide('evolutionState', {
      loadReviewState: async () => null,
      saveReviewState: async () => {},
      loadCuratorState: async () => ({ schemaVersion: 1, lastRunAt: Date.now() - 25 * 3_600_000, runCount: 3, paused: false, lastSummary: '' }),
      saveCuratorState: async () => {},
      transactCuratorState: async () => {},
      listPending: async () => [],
      savePending: async () => {},
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
    })
    let listCalls = 0
    // G4: the idleness gate reads the family's evolutionActivity projection, which folds the
    // session's own log — so the presented session is a REAL one (the projection is the
    // post-0.1.5 read of exactly the log the loop appends).
    const recent = ctx.sessions.create(SessionId('curator-recent-session'))
    recent.append('turn/start', { turn: 1 })
    ctx.provide('agents', {
      list: () => {
        listCalls += 1
        if (listCalls === 1) return []
        return [{ session: recent }]
      },
    })
    // v32 TEST-02 (CUR-04): a live skill with NO usage sidecar must get its
    // baseline PERSISTED even when the run is skipped — otherwise a busy host
    // re-seeds a fresh created_at on every blocked run and the skill can never
    // reach staleAfterDays.
    const skillsDir = join(home, 'skills', 'seeded-skill')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, 'SKILL.md'), '---\nname: seeded-skill\ndescription: Seed.\n---\n\nbody\n', 'utf8')
    const result = await ctx.evolutionCurator.run()
    expect(result.skipped).toBe('active-session')
    expect(result.stale).toEqual([])
    // CUR-04: the baseline landed in the sidecar despite the skip.
    const { loadUsage } = await import('@deepseek-ai/dsh-evolution-core')
    const { nodeEvolutionIo } = await import('@deepseek-ai/dsh-evolution-core')
    const usage = await loadUsage(join(home, 'skills'), nodeEvolutionIo())
    const record = usage.get('seeded-skill')
    expect(record?.state).toBe('active')
    expect(typeof record?.created_at).toBe('string')
  })

  it('ignores a malformed report file instead of crashing the report reader', async () => {
    const home = await tempHome('dsh-curator-report-')
    const ctx = await mount(home)
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(evolutionHome(), 'reports', 'curator-bad.json'), '{broken')
    expect(await ctx.evolutionCurator.latestReport()).toBeNull()
  })

  it('H-07: setPaused warns when the curator state service is absent (pause not persisted)', async () => {
    const home = await tempHome('dsh-curator-pause-')
    // No evolutionState service mounted: the optional-chain form used to make
    // setPaused a silent no-op — the command surface reported success while
    // nothing was persisted. The warn must declare the loss.
    // OPT-21: the wording also declares the in-process effect (none — there
    // is no memory paused flag; auto-runs continue in this process).
    const ctx = await mount(home)
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await expect(ctx.evolutionCurator.setPaused(true)).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('curator state service absent — pause NOT effective'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('this process keeps auto-running'))
    warnSpy.mockRestore()
  })
})
