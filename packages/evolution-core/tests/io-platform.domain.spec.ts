// @tier pre-tag
import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import EvolutionIoRegistry from '../src/io-registry.ts'
import { apply as mountPlatformIo } from '../src/io-platform.ts'
import { SkillLibrary } from '../src/skill-store.ts'
import { DEFAULT_SKILL_LIMITS } from '../src/limits.ts'

function body(name: string, text = 'Body.'): string {
  return `---\nname: ${name}\ndescription: platform io fixture\n---\n${text}\n`
}

it('runs the real skill write path on the platform filesystem backend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evolution-platform-domain-'))
  try {
    const ctx = new Context()
    new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 1_048_576 })
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin({ apply: mountPlatformIo, inject: ['evolutionIo', 'fs'] })
    const registry = ctx.get('evolutionIo') as { provider(): ReturnType<typeof import('../src/io-platform.ts')['platformEvolutionIo']> }
    const lib = new SkillLibrary(root, registry.provider(), DEFAULT_SKILL_LIMITS)
    const created = await lib.create('platform-skill', body('platform-skill'), 'foreground')
    expect(created.ok, created.message).toBe(true)
    const updated = await lib.update('platform-skill', body('platform-skill', 'Updated.'), 'foreground')
    expect(updated.ok, updated.message).toBe(true)
    expect(await lib.read('platform-skill')).toContain('Updated.')
    const support = await lib.writeSupportFile('platform-skill', 'references/a.md', '# a\n', 'foreground')
    expect(support.ok, support.message).toBe(true)
    expect(await readFile(join(root, 'platform-skill', 'references', 'a.md'), 'utf8')).toBe('# a\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
