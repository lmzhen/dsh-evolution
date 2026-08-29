import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-evolution-core'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import * as Catalog from '../src/index.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Decision C acceptance: the mutation event is emitted by SkillLibrary itself,
 * so EVERY write path — tool, curator archive/consolidate/restore, snapshot
 * restore — invalidates the native catalog immediately with no manual emit.
 * Each case drives the real SkillLibrary instance back-to-back with the real
 * skill provider; no fake events are emitted by the test itself.
 */

const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody of ${name}.\n`

describe('catalog invalidation covers every write path (decision C)', () => {
  async function setup(): Promise<{
    root: string
    library: SkillLibrary
    catalogOf: (name: string) => Promise<{ name: string; description: string } | undefined>
  }> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-catalog-paths-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(Catalog, { root })
    const io = ctx.evolutionIo.provider('node')
    const library = new SkillLibrary(root, io, undefined, (event) => { ctx.emit('evolution/skill-mutated', event) })
    const catalogOf = async (name: string) => (await ctx.skills.snapshot()).skills.find(item => item.name === name)
    return { root, library, catalogOf }
  }

  it('content write paths (create / update / patch / write_file / remove_file) refresh the catalog', async () => {
    const { root, library, catalogOf } = await setup()
    expect(await catalogOf('alpha')).toBeUndefined()

    await library.create('alpha', skill('alpha', 'first description'), 'foreground')
    expect(await catalogOf('alpha')).toBeDefined()

    await library.update('alpha', skill('alpha', 'second description'), 'foreground')
    expect((await catalogOf('alpha'))?.description).toBe('second description')

    await library.patch('alpha', 'Body of alpha.', 'Patched body.', '', false, 'foreground')
    expect(await catalogOf('alpha')).toBeDefined()

    await library.writeSupportFile('alpha', 'references/note.md', '# note', 'foreground')
    await library.removeSupportFile('alpha', 'references/note.md', 'foreground')
    expect(await catalogOf('alpha')).toBeDefined()

    await rm(root, { recursive: true, force: true })
  })

  it('lifecycle write paths (archive / restore / consolidate / snapshot restore) refresh the catalog', async () => {
    const { root, library, catalogOf } = await setup()
    await library.create('bravo', skill('bravo', 'b'), 'foreground')
    await library.create('charlie', skill('charlie', 'c'), 'foreground')
    expect(await catalogOf('charlie')).toBeDefined()

    await library.archive('charlie')
    expect(await catalogOf('charlie')).toBeUndefined()

    await library.restoreFromArchive('charlie')
    expect(await catalogOf('charlie')).toBeDefined()

    await library.consolidate('bravo', ['charlie'], 'foreground')
    expect(await catalogOf('bravo')).toBeDefined()
    expect(await catalogOf('charlie')).toBeUndefined()

    await library.snapshotAll('pre-sync (decision C)')
    await library.archive('bravo')
    expect(await catalogOf('bravo')).toBeUndefined()
    await library.restoreLatestSnapshot()
    expect(await catalogOf('bravo')).toBeDefined()

    await rm(root, { recursive: true, force: true })
  })
})
