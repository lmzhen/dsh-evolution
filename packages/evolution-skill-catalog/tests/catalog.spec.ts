import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-evolution-core'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as Catalog from '../src/index.ts'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'
import { tempRoot } from '../../test-support/temp-home.ts'

describe('evolution-skill-catalog', () => {
  it('publishes evolution skills into ctx.skills and invalidates after mutations', async () => {
    const root = await tempRoot('dsh-skill-catalog-')
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

  })

  it('V27 G5.3: the published content is the BODY, matching the upstream filesystem provider', async () => {
    const root = await tempRoot('dsh-skill-catalog-content-')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(Catalog, { root })
    const io = ctx.evolutionIo.provider('node')
    const skillDir = join(root, 'body-skill')
    const content = '---\nname: body-skill\ndescription: Body contract test.\n---\n\n# Body\n\nDo body work.\n'
    await io.writeText(join(skillDir, 'SKILL.md'), content)
    ctx.emit('evolution/skill-mutated', { action: 'create', name: 'body-skill' })
    const definition = await ctx.skills.get('body-skill')
    // The frontmatter block is the catalog's routing metadata, not model-visible
    // skill content: the upstream filesystem provider publishes
    // `parsed.body.trim()`, and this provider shadows it for the same skills.
    expect(definition?.content).toBe('# Body\n\nDo body work.')
    expect(definition?.content ?? '').not.toContain('---')
    expect(definition?.description).toBe('Body contract test.')
  })

  it('X-7: repeated get() reuses the summaries cache; refresh drops it (0.3.18)', async () => {
    const root = await tempRoot('dsh-skill-catalog-cache-')
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
  })

  it('E-71: an out-of-band tree edit becomes visible via /evolution skills refresh (0.3.18)', async () => {
    const root = await tempRoot('dsh-skill-catalog-oob-')
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
    // P3 (v15): the invisibility is the UPSTREAM registry's collect cache
    // (get/list are served without consulting providers until
    // control.invalidate bumps the revision), not this provider's caches.
    await base.writeText(join(root, 'other-skill', 'SKILL.md'), make('other-skill', 'Second skill.'))
    expect(await ctx.skills.get('other-skill')).toBeUndefined()
    ctx.emit('evolution/skills-refresh')
    // After the refresh the mtime stamp rebuilds the cache AND the registry
    // re-collects: the out-of-band skill is visible without a restart.
    expect((await ctx.skills.get('other-skill'))?.name).toBe('other-skill')
  })

  it('P1-1 (v18): an upstream-invalid name or empty description is not published (and does not break snapshot)', async () => {
    const root = await tempRoot('dsh-skill-catalog-publishable-')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(Catalog, { root })
    const io = ctx.evolutionIo.provider('node')
    const make = (name: string, frontmatter: string) => `---\nname: ${name}\n${frontmatter}---\n\n# ${name}\n\nBody.\n`
    // The mirror name guard permits a trailing hyphen; upstream SKILL_NAME
    // does not. It must be filtered, not forwarded (one bad candidate aborts
    // the whole upstream collection, breaking agent/pre-step every turn).
    // Each skill is a DIRECTORY carrying SKILL.md: `SkillLibrary.list()` walks
    // `root/<name>/SKILL.md` (listNames), so a file named `root/<name>` is not
    // an entry at all and would make this test pass vacuously on an empty tree.
    await io.writeText(join(root, 'trailing-', 'SKILL.md'), make('trailing-', 'description: Valid description but invalid name.\n'))
    // A description-less SKILL.md is visible to the curator (C-14) but must
    // not reach the platform registry (upstream refuses empty descriptions).
    await io.writeText(join(root, 'no-description', 'SKILL.md'), make('no-description', ''))
    await io.writeText(join(root, 'good-skill', 'SKILL.md'), make('good-skill', 'description: A valid skill.\n'))
    ctx.emit('evolution/skills-refresh')
    const names = (await ctx.skills.snapshot()).skills.map(skill => skill.name)
    expect(names).toContain('good-skill')
    expect(names).not.toContain('trailing-')
    expect(names).not.toContain('no-description')
    // get() applies the same filter (the valid-name/empty-description case
    // actually reaches the provider; the trailing-hyphen case is rejected by
    // the upstream registry before the provider is consulted).
    expect(await ctx.skills.get('trailing-')).toBeUndefined()
    expect(await ctx.skills.get('no-description')).toBeUndefined()
  })

  it('F-14 (v18): includeSkillNames/excludeSkillNames gate publication', async () => {
    const root = await tempRoot('dsh-skill-catalog-filter-')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(Catalog, { root, includeSkillNames: ['keep-me'], excludeSkillNames: ['skip-me'] })
    const io = ctx.evolutionIo.provider('node')
    for (const name of ['keep-me', 'skip-me', 'other']) {
      await io.writeText(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: A skill.\n---\n\n# ${name}\n`)
    }
    ctx.emit('evolution/skills-refresh')
    const names = (await ctx.skills.snapshot()).skills.map(skill => skill.name)
    // An allow-list of one: everything else is invisible, including the
    // explicitly excluded name (exclude wins over the implicit allow).
    expect(names).toContain('keep-me')
    expect(names).not.toContain('skip-me')
    expect(names).not.toContain('other')
  })

  it('OPT-10: per-skill `disable-model-invocation` / `user-invocable` frontmatter overrides the row default', async () => {
    // Before, the row-level policy was stamped onto EVERY candidate — a
    // user's `disable-model-invocation: true` in the shared tree was
    // silently re-advertised as model-invocable by the shadow (the upstream
    // provider it shadows parses this frontmatter per skill).
    const root = await tempRoot('dsh-skill-catalog-invocation-')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(Catalog, { root, modelInvocable: false })
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'hidden-from-model', 'SKILL.md'), '---\nname: hidden-from-model\ndescription: Must not reach the model.\ndisable-model-invocation: true\n---\n\n# Hidden\n')
    await io.writeText(join(root, 'user-only', 'SKILL.md'), '---\nname: user-only\ndescription: User surfaces only.\nuser-invocable: false\n---\n\n# UserOnly\n')
    await io.writeText(join(root, 'plain-skill', 'SKILL.md'), '---\nname: plain-skill\ndescription: Row defaults apply.\n---\n\n# Plain\n')
    ctx.emit('evolution/skills-refresh')
    const skills = (await ctx.skills.snapshot()).skills
    const hidden = skills.find(skill => skill.name === 'hidden-from-model')
    const userOnly = skills.find(skill => skill.name === 'user-only')
    const plain = skills.find(skill => skill.name === 'plain-skill')
    expect(hidden?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    expect(userOnly?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    // No frontmatter → the ROW default (modelInvocable:false here) applies.
    expect(plain?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    // A malformed boolean falls back to the row default with a warn, not a
    // broken scan (upstream would throw; the shadow degrades).
    await io.writeText(join(root, 'bad-flag', 'SKILL.md'), '---\nname: bad-flag\ndescription: Bad boolean.\ndisable-model-invocation: maybe\n---\n\n# Bad\n')
    ctx.emit('evolution/skills-refresh')
    const bad = (await ctx.skills.snapshot()).skills.find(skill => skill.name === 'bad-flag')
    expect(bad?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
  })

})
