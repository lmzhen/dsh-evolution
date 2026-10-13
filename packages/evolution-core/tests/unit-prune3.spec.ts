import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const stamp = String.fromCharCode(10)
const bodyWithExtra = ['---', 'name: q-skill', 'description: q-skill body', '---', '', '## Extra', 'extra content', ''].join(stamp)

it('R-G3a-5：keep=1 时单元的条目必须整组保留（支撑 + baseline + 正文，同一 unitId）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-unit-prune3-'))
  try {
    const lib = new SkillLibrary(root, nodeEvolutionIo(), { versionKeep: 1 })
    await lib.create('q-skill', bodyWithExtra)
    const result = await lib.restructure('q-skill', [{ heading: 'Extra', toFile: 'references/extra.md' }], 'foreground')
    expect(result.ok, result.message).toBe(true)
    const versions = await lib.listVersions('q-skill')
    const ids = versions.map(v => (v as { unitId?: string }).unitId).filter((u): u is string => typeof u === 'string' && u.length > 0)
    expect(new Set(ids).size).toBe(1)
    expect(ids.length).toBe(3)
  } finally { await rm(root, { recursive: true, force: true }) }
})
