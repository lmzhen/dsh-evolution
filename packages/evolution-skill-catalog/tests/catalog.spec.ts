import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-evolution/src/events.ts'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as Catalog from '../src/index.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('evolution-skill-catalog', () => {
  it('publishes evolution skills into ctx.skills and invalidates after mutations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-catalog-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(Catalog, { root })

    const io = ctx.evolutionIo.provider('node')

    const before = (await ctx.skills.snapshot()).skills
    expect(before.find(candidate => candidate.name === 'demo-skill')).toBeUndefined()

    const skillDir = join(root, 'demo-skill')
    const content = '---\nname: demo-skill\ndescription: Demo skill for catalog tests.\n---\n\n# Demo\n\nDo demo work.\n'
    await io.writeText(join(skillDir, 'SKILL.md'), content)

    // The registry caches completed catalogs; only the explicit invalidation
    // event should make this new skill visible without a filesystem watcher.
    ctx.emit('evolution/skill-mutated', { action: 'create', name: 'demo-skill' })
    const after = (await ctx.skills.snapshot()).skills
    const candidate = after.find(item => item.name === 'demo-skill')
    expect(candidate).toBeDefined()
    expect(candidate?.provider).toBe('dsh-evolution')

    await rm(root, { recursive: true, force: true })
  })
})
