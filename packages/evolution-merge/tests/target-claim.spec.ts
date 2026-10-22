// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { acquireTargetClaim } from '../src/target-claim.ts'

it('one approve writer per target at a time', async () => {
  const home = await tempRoot('dsh-merge-target-claim-')
  const io = nodeEvolutionIo()
  const first = await acquireTargetClaim(io, home, 'alpha', 1)
  assert.notEqual(first, null)
  assert.equal(await acquireTargetClaim(io, home, 'alpha', 1), null)
  await first?.release()
  const again = await acquireTargetClaim(io, home, 'alpha', 2)
  assert.notEqual(again, null)
  await again?.release()
})
