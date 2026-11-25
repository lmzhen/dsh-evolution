// @tier fast
import { describe, expect, it } from 'vitest'
import { HomeFence } from '../../src/home-fence.ts'
import { nodeEvolutionIo } from '../../src/io.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { buildTreeManifest, readTreeManifest } from '../../src/store/tree-manifest.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

describe('tree manifest', () => {
  it('canonicalizes a unit and rides the commit tree ref', async () => {
    const home = await tempRoot('dsh-tree-manifest-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home, fence: new HomeFence({ home }) })
    await kernel.bootstrap({ state: { version: 1 } })
    const ops = [
      { kind: 'write' as const, target: 'skills/b/SKILL.md', content: 'b\n' },
      { kind: 'write' as const, target: 'skills/a/SKILL.md', content: 'a\n' },
      { kind: 'delete' as const, target: 'skills/c/SKILL.md' },
    ]
    const manifest = buildTreeManifest('unit-1', ops)
    expect(manifest.entries.map(entry => entry.path)).toEqual(['skills/a/SKILL.md', 'skills/b/SKILL.md', 'skills/c/SKILL.md'])
    const result = await kernel.mutate({ domains: [], source: 'tool', change: () => ({}), tree: { unitId: 'unit-1' }, treeManifest: manifest })
    expect(result.tree?.unitId).toBe('unit-1')
    expect((await kernel.query(['state'])).tree).toEqual(result.tree)
    expect(await readTreeManifest(kernel, result.tree)).toEqual(manifest)
  })
})
