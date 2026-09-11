import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as MaintenanceTools from '../src/tools.ts'

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
    const root = await mkdtemp(join(tmpdir(), 'evo-probe-root-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
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
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
