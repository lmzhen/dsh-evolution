// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { cleanupStage, dropStage } from '../src/domain/stage-aggregate.ts'
import { join } from 'node:path'

it('reports cleanup remove failures instead of swallowing them', async () => {
  const home = await tempRoot('dsh-merge-cleanup-failure-')
  const io = nodeEvolutionIo()
  await io.writeText(join(home, 'merge', 'runs', 'orphan', 'x'), 'x')
  const failing = { ...io, async remove() { throw new Error('disk full') } }
  const result = await cleanupStage(failing, home, 0, new Map(), 100)
  expect(result.orphans).toContain('orphan')
  expect(result.failures).toHaveLength(1)
  expect(result.failures[0]?.message).toContain('disk full')
})

it('dropStage forwards index and tree removal errors', async () => {
  const home = await tempRoot('dsh-merge-drop-failure-')
  const io = nodeEvolutionIo()
  const seen: string[] = []
  const failing = { ...io, async remove(path: string) { seen.push(path); throw new Error('denied') } }
  await dropStage(failing, home, 'r1', 'tree-1', path => seen.push('err:' + path))
  expect(seen.some(item => item.endsWith('r1.json'))).toBe(true)
  expect(seen.some(item => item === 'err:' + join(home, 'merge', 'staging-index', 'r1.json'))).toBe(true)
})
