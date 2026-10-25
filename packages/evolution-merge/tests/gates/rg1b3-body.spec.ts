// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { resolveBody } from '../../src/surface/body.ts'

async function homeWithStage(state: 'present' | 'lost' | 'expired'): Promise<{ home: string; io: ReturnType<typeof nodeEvolutionIo> }> {
  const home = await tempRoot('dsh-rg1b3-body-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge', 'staging-index'), { recursive: true })
  await writeFile(join(home, 'merge', 'staging-index', 'r1.json'), JSON.stringify({ version: 2, rowId: 'r1', state, ref: 'run-1/pairs/target', target: 'target', expiresAt: 9, updatedAt: 'u' }))
  if (state === 'present') {
    await mkdir(join(home, 'merge', 'runs', 'run-1', 'pairs', 'target', 'merged'), { recursive: true })
    await writeFile(join(home, 'merge', 'runs', 'run-1', 'pairs', 'target', 'merged', 'a'), 'STAGE BODY')
  }
  return { home, io }
}

it('prefers a present stage body over the row body', async () => {
  const { home, io } = await homeWithStage('present')
  expect(await resolveBody(io, home, { rowId: 'r1', name: 'a', side: 'live' }, async () => 'ROW BODY')).toBe('STAGE BODY')
})

it('returns null for lost/expired stage and does not fall back to the row body', async () => {
  for (const state of ['lost', 'expired'] as const) {
    const { home, io } = await homeWithStage(state)
    expect(await resolveBody(io, home, { rowId: 'r1', name: 'a', side: 'live' }, async () => 'ROW BODY')).toBeNull()
  }
})
