// @vitest-environment node
/**
 * T2-05/A20: one `create` pays ONE whole-tree listing.
 *
 * The tool path asks the platform catalog for the cross-source winner BEFORE the write, and the
 * catalog provider answers by scanning the tree (one SKILL.md read per skill). If anything in the
 * same operation makes that observation stale and asks again, the whole tree is walked twice for a
 * single create.
 */
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as Catalog from '@deepseek-ai/dsh-evolution-skill-catalog'
import * as ToolSkillManage from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeAgent = (origin: string | undefined): Agent => ({ session: { header: { origin }, append: () => {} } }) as unknown as Agent

const body = (name: string): string => `---\nname: ${name}\ndescription: ${name} summary.\n---\n\n# ${name}\n`

it('T2-05/A20: one create reads each existing SKILL.md once (no second whole-tree pass)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-create-tree-reads-'))
  const base = nodeEvolutionIo()
  const names = ['alpha-skill', 'beta-skill', 'gamma-skill', 'delta-skill']
  for (const name of names) await base.writeText(join(root, name, 'SKILL.md'), body(name))
  let skillMdReads = 0
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider({
    name: 'counting',
    ...base,
    readText: async (path) => {
      if (path.endsWith('SKILL.md')) skillMdReads += 1
      return await base.readText(path)
    },
  })
  // The tool's `inject` names skillUsage, so the plugin only applies once it is mounted.
  await ctx.plugin(SkillUsageRegistry, { root: await mkdtemp(join(tmpdir(), 'dsh-create-usage-')) })
  await ctx.plugin(Catalog, { root })
  await ctx.plugin(ToolSkillManage, { root })
  const tool = ctx.tools.get('skill_manage')!
  const execArg = { agent: fakeAgent(undefined) } as unknown as Parameters<typeof tool.execute>[1]
  const created = await tool.execute({ action: 'create', name: 'brand-new-skill', content: body('brand-new-skill') }, execArg) as { ok: boolean; message: string }
  expect(created.ok).toBe(true)
  // ONE listing for the whole create: the cross-source probe's scan is the only whole-tree pass.
  expect(skillMdReads).toBe(names.length)
  await ctx.fiber.dispose()
})
