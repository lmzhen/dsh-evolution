import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-evolution-core'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as Catalog from '../src/index.ts'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
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

  it('X-7: repeated get() reuses the summaries cache; refresh drops it (0.3.18)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-catalog-cache-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    const base = nodeEvolutionIo()
    let listCalls = 0
    ctx.evolutionIo.registerProvider({
      name: 'count',
      ...base,
      list: async (path) => {
        listCalls += 1
        return base.list(path)
      },
    })
    await ctx.plugin(Catalog, { root })
    const content = '---\nname: demo-skill\ndescription: Demo skill for cache tests.\n---\n\n# Demo\n\nDo demo work.\n'
    await base.writeText(join(root, 'demo-skill', 'SKILL.md'), content)
    ctx.emit('evolution/skill-mutated', { action: 'create', name: 'demo-skill' })

    const first = await ctx.skills.get('demo-skill')
    expect(first?.name).toBe('demo-skill')
    const scansAfterFirst = listCalls
    const second = await ctx.skills.get('demo-skill')
    expect(second?.name).toBe('demo-skill')
    // The provider's get() runs per call but must NOT re-scan the tree.
    expect(listCalls).toBe(scansAfterFirst)

    // Explicit refresh drops the cache; the next lookup re-scans.
    ctx.emit('evolution/skills-refresh')
    const afterRefresh = await ctx.skills.get('demo-skill')
    expect(afterRefresh?.name).toBe('demo-skill')
    expect(listCalls).toBeGreaterThan(scansAfterFirst)
    await rm(root, { recursive: true, force: true })
  })

  it('E-71: an out-of-band tree edit becomes visible via /evolution skills refresh (0.3.18)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-catalog-oob-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    const base = nodeEvolutionIo()
    ctx.evolutionIo.registerProvider({ name: 'node', ...base })
    await ctx.plugin(Catalog, { root })
    const make = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody.\n`
    await base.writeText(join(root, 'demo-skill', 'SKILL.md'), make('demo-skill', 'First skill.'))
    ctx.emit('evolution/skill-mutated', { action: 'create', name: 'demo-skill' })
    expect((await ctx.skills.get('demo-skill'))?.name).toBe('demo-skill')
    // Direct filesystem write WITHOUT any evolution event (git pull of a new
    // skill directory). Invisible until the explicit refresh signal — the
    // documented out-of-band limitation (decision C: no filesystem watcher).
    await base.writeText(join(root, 'other-skill', 'SKILL.md'), make('other-skill', 'Second skill.'))
    expect(await ctx.skills.get('other-skill')).toBeUndefined()
    ctx.emit('evolution/skills-refresh')
    // After the refresh the mtime stamp rebuilds the cache AND the registry
    // re-collects: the out-of-band skill is visible without a restart.
    expect((await ctx.skills.get('other-skill'))?.name).toBe('other-skill')
    await rm(root, { recursive: true, force: true })
  })
})
