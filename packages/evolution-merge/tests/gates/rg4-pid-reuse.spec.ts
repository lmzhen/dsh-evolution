// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, contentHash } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'
import { acquireTargetClaim } from '../../src/target-claim.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

it('reclaims a target claim left by the same pid in an older process instance', async () => {
  const home = await tempRoot('dsh-rg4-claim-pid-')
  const io = nodeEvolutionIo()
  const first = await acquireTargetClaim(io, home, 'alpha', 1)
  expect(first).not.toBeNull()
  const path = join(home, 'merge', 'claims', contentHash('alpha') + '.json')
  await writeFile(path, JSON.stringify({ id: 'claim', token: 'old', expiresAt: Number.MAX_SAFE_INTEGER, pid: process.pid, startedAt: 1 }) + '\n')
  const reclaimed = await acquireTargetClaim(io, home, 'alpha', 2)
  expect(reclaimed).not.toBeNull()
  await reclaimed?.release()
})
