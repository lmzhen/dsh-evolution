// @tier pre-tag
import { expect, it } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { cleanupStage } from '../src/domain/stage-aggregate.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

it('P0-3: refuses a traversal staging ref and keeps the outside tree', async () => {
  const home = await tempRoot('dsh-stage-cleanup-traversal-')
  try {
    const io = nodeEvolutionIo()
    const indexRoot = join(home, 'merge', 'staging-index')
    await mkdir(indexRoot, { recursive: true })
    await mkdir(join(home, 'outside'), { recursive: true })
    await writeFile(join(home, 'outside', 'marker.txt'), 'keep')
    await writeFile(join(indexRoot, 'row-evil.json'), JSON.stringify({ rowId: 'row-evil', pairKey: 'p', ref: '../../outside', expiresAt: 1, createdAt: 1, state: 'present' }))
    const result = await cleanupStage(io, home, 2, new Map([['row-evil', { state: 'skipped' }]]), 100)
    expect(result.failures.some(failure => failure.message.includes('invalid staging ref'))).toBe(true)
    expect(await io.exists(join(home, 'outside', 'marker.txt'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('P1-7: collects refs from every index before deleting run trees', async () => {
  const home = await tempRoot('dsh-stage-cleanup-101-')
  try {
    const io = nodeEvolutionIo()
    const indexRoot = join(home, 'merge', 'staging-index')
    await mkdir(indexRoot, { recursive: true })
    for (let i = 0; i < 101; i += 1) {
      const rowId = 'row-' + String(i).padStart(3, '0')
      await writeFile(join(indexRoot, rowId + '.json'), JSON.stringify({ rowId, pairKey: 'p' + String(i), ref: i === 100 ? 'run-live' : 'run-' + String(i), expiresAt: Number.MAX_SAFE_INTEGER, createdAt: 1, state: 'present' }))
    }
    await mkdir(join(home, 'merge', 'runs', 'run-live'), { recursive: true })
    await mkdir(join(home, 'merge', 'runs', 'run-orphan'), { recursive: true })
    const result = await cleanupStage(io, home, 2, new Map([['row-100', { state: 'fuse' }]]), 100)
    expect(result.orphans).toContain('run-orphan')
    expect(result.orphans).not.toContain('run-live')
    expect(await io.exists(join(home, 'merge', 'runs', 'run-live'))).toBe(true)
    expect(await io.exists(join(home, 'merge', 'runs', 'run-orphan'))).toBe(false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
