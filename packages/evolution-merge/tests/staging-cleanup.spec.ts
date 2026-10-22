// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { cleanupExpiredStaging, createStaging, readStaging } from '../src/staging.ts'

const input = (runId: string, ttlDays: number) => ({ runId, target: 't', sources: [{ name: 's', body: '# s', files: [] }], promptVersion: 'p', ttlDays, now: () => 1000 })

it('staging cleanup removes expired runs, respects keep and half-created', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-staging-cleanup-'))
  const io = nodeEvolutionIo()
  try {
    assert.equal((await createStaging(io, home, input('old', 0))).ok, true)
    assert.equal((await createStaging(io, home, input('live', 7))).ok, true)
    const result = await cleanupExpiredStaging(io, home, 2000)
    assert.deepEqual(result.removed, ['old'])
    assert.equal((await readStaging(io, home, 'live')).kind, 'present')
    const kept = await cleanupExpiredStaging(io, home, 2000, new Set(['old']))
    assert.equal(kept.removed.length, 0)
  } finally { await rm(home, { recursive: true, force: true }) }
})
