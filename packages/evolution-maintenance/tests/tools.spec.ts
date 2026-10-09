import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { emptyRecord, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as MaintenanceTools from '../src/tools.ts'
import { tempHome } from '../../test-support/temp-home.ts'

describe('evolution-maintenance tools registration', () => {
  it('binds the register disposer to the plugin fiber (G4.2)', async () => {
    const ctx = new Context()
    const registered: Array<{ name?: string }> = []
    let removed = 0
    ctx.provide('tools', {
      register: (definition: { name?: string }) => {
        registered.push(definition)
        return () => { removed += 1 }
      },
      get: () => undefined,
    } as never)
    await ctx.plugin(MaintenanceTools, {})
    expect(registered.map(tool => tool.name)).toContain('maintenance_probe')
    expect(removed).toBe(0)
    // Disposing the fiber must run the register disposer: an HMR reload of
    // this plugin actually removes the tool instead of leaking the registration.
    await ctx.fiber.dispose()
    expect(removed).toBe(1)
  })

  it('V4-16: an empty/whitespace/undefined config skillsRoot resolves to the default, not a CWD-relative root', async () => {
    const root = await tempHome('evo-probe-root-')
    const skillDir = join(root, 'skills', 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Probe root test.\n---\n\n# Demo\n\nbody\n', 'utf8')
    const probePath = join(skillDir, 'SKILL.md')
    // V4-16: an empty, a whitespace-only, and an ABSENT skillsRoot all fall
    // back to the default root. A literal `skillsRoot: undefined` cannot be
    // expressed here: the loader's config type derives from the schemastery
    // ObjectS, whose optional fields admit `string | null` and not
    // `undefined` under exactOptionalPropertyTypes. `resolveRootConfig` and
    // `assertSkillsRootAliasRetired` both normalize through `?? ''`, so the
    // absent key is exactly the retired-undefined case under test.
    for (const cfg of [{ skillsRoot: '' }, { skillsRoot: '   ' }, {}] satisfies MaintenanceTools.Config[]) {        const ctx = new Context()
      const registered: Array<{ name?: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
      ctx.provide('tools', {
        register: (definition: unknown) => {
          registered.push(definition as typeof registered[0])
          return () => {}
        },
        get: () => undefined,
      } as never)
      const io = nodeEvolutionIo()
      const readPaths: string[] = []
      ctx.provide('evolutionIo', {
        provider: () => ({
          ...io,
          readText: async (path: string) => {
            readPaths.push(path)
            return io.readText(path)
          },
        }),
      })
      await ctx.plugin(MaintenanceTools, cfg)
      const tool = registered.find(t => t.name === 'maintenance_probe')
      expect(tool).toBeDefined()
      // The probe reads through launch-enrichment → SkillLibrary.root; a
      // correctly resolved default root reads the skill under DSH_HOME/skills.
      await tool!.execute({ signal: 'description_chars', target: 'demo-skill' }, {})
      expect(readPaths).toContain(probePath)
      await ctx.fiber.dispose()
    }
  })
  it('T3-02/A30: the probe ages a skill through the SAME enrichment the facts block uses — an idle one still yields retirement candidates', async () => {
    const root = await tempHome('evo-probe-liveness-')
    const skillDir = join(root, 'skills', 'demo-skill')
    await mkdir(join(skillDir, 'references'), { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Probe liveness test.\n---\n\n# Demo\n\nbody without a support-file mention\n', 'utf8')
    await writeFile(join(skillDir, 'references', 'dead.md'), 'never read\n', 'utf8')
    const ctx = new Context()
    const registered: Array<{ name?: string; execute: (args: unknown, exec: unknown) => Promise<{ detail: string[] }> }> = []
    ctx.provide('tools', {
      register: (definition: unknown) => {
        registered.push(definition as typeof registered[0])
        return () => {}
      },
      get: () => undefined,
    } as never)
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    // The usage sidecar the enrichment reads: one record with an observed read (so the demand
    // window is OPEN — before the first observed read zero reads are not evidence) and an old
    // activity anchor (so the skill is past DEFAULT_STALE_AFTER_DAYS).
    const old = new Date(2021, 0, 1).toISOString()
    ctx.provide('skillUsage', {
      report: async () => new Map([['demo-skill', { ...emptyRecord(), view_count: 1, created_at: old, last_used_at: old }]]),
    })
    await ctx.plugin(MaintenanceTools, {})
    const tool = registered.find(t => t.name === 'maintenance_probe')
    // T3-02: the probe assembled its snapshots from its own option literal, which had lost
    // `liveness` — every skill answered `retire: no-age` ("not enough evidence") for ever while
    // the facts block listed the candidate. Both channels now read one mapping.
    const probe = await tool!.execute({ signal: 'demand', target: 'demo-skill' }, {})
    expect(probe.detail).toContain('never read: references/dead.md')
    expect(probe.detail.some(line => line.includes('retire candidate: references/dead.md'))).toBe(true)
    expect(probe.detail).not.toContain('retire: no-age')
  })
})
