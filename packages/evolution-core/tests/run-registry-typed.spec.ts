// @tier pre-tag
import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, newRunRegistry } from '../src/index.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

it('ensureLoaded throws on invalid runs and findActive is explicit', async () => {
  const home = await tempRoot('dsh-run-typed-')
  const io = nodeEvolutionIo()
  const registry = newRunRegistry({ io, home })
  await expect(registry.ensureLoaded()).resolves.toBeUndefined()
  expect(await registry.findActive()).toBeUndefined()
  const handle = await registry.begin('merge')
  expect((await registry.findActive('merge'))?.id).toBe(handle.id)
  await writeFile(home + '/runs.json', 'not json')
  const broken = newRunRegistry({ io, home })
  await expect(broken.ensureLoaded()).rejects.toThrow()
})
