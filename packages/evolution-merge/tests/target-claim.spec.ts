// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { acquireTargetClaim } from '../src/target-claim.ts'

it('one approve writer per target at a time', async () => {
  const home = await tempRoot('dsh-merge-target-claim-')
  const io = nodeEvolutionIo()
  const [first, second] = await Promise.all([acquireTargetClaim(io, home, 'alpha', 1), acquireTargetClaim(io, home, 'alpha', 1)])
  assert.equal([first, second].filter(Boolean).length, 1)
  const holder = first ?? second
  assert.equal(await acquireTargetClaim(io, home, 'alpha', 1), null)
  await holder?.release()
  const again = await acquireTargetClaim(io, home, 'alpha', 2)
  assert.notEqual(again, null)
  await again?.release()
})
