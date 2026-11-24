// @tier fast
import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MutationAuthority } from '../../src/mutation-authority.ts'
import { newSkillLibrary } from '../../src/skill-store.ts'
import { nodeEvolutionIo } from '../../src/io.ts'
import { authorityFrom } from '../../src/write-authority.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { readTreeManifest } from '../../src/store/tree-manifest.ts'
import { STATE_V2_MIGRATION_MARKER } from '../../src/state/constants.ts'
import { tempHome } from '../../../test-support/temp-home.ts'

const skill = (name: string) => '---\nname: ' + name + '\ndescription: Tree manifest boundary fixture with a unique body.\n---\n\n# ' + name + '\n\n## Details\n\nDetail text for the restructure fixture.\n'

it('publishes a manifest after the outer mutation lock is released', async () => {
  const home = await tempHome('dsh-tree-boundary-')
  const evolution = join(home, 'evolution')
  await mkdir(join(evolution, 'state'), { recursive: true })
  await writeFile(join(evolution, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
  const io = nodeEvolutionIo()
  const authority = new MutationAuthority({ io, home: evolution })
  const kernel = new StoreKernel({ io, home: evolution, fence: authority.homeFence })
  await kernel.bootstrap({ state: { version: 1 } })
  const lib = newSkillLibrary({
    config: { root: join(home, 'skills') },
    io,
    authority: authorityFrom({ origin: 'foreground' }),
    mutationLock: authority.mutationLock,
    fence: authority.homeFence,
    ctx: { emit: () => {}, get: () => undefined } as never,
  })
  const created = await lib.create('tree-skill', skill('tree-skill'), 'foreground')
  expect(created.ok, created.message).toBe(true)
  const snapshot = await kernel.query(['state'])
  expect(snapshot.tree).not.toBeNull()
  const manifest = await readTreeManifest(kernel, snapshot.tree)
  expect(manifest?.entries.some(entry => entry.path.endsWith('SKILL.md'))).toBe(true)
  const updated = await lib.update('tree-skill', skill('tree-skill') + '\nupdated\n', 'foreground')
  expect(updated.ok, updated.message).toBe(true)
  const after = await kernel.query(['state'])
  expect(after.commitId).not.toBe(snapshot.commitId)
  expect((await readTreeManifest(kernel, after.tree))?.unitId).not.toBe(manifest?.unitId)
  const restructured = await lib.restructure('tree-skill', [{ heading: 'Details', toFile: 'references/details.md' }], 'foreground')
  expect(restructured.ok, restructured.message).toBe(true)
  const restructuredTree = await kernel.query(['state'])
  expect(restructuredTree.commitId).not.toBe(after.commitId)
  expect(await readTreeManifest(kernel, restructuredTree.tree)).not.toBeNull()
}, 30_000)
