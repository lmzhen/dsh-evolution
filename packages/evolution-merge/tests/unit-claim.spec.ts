// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { targetClaimUnitPort } from '../src/unit-claim.ts'

it('acquires one commit claim and releases it immediately', async () => {
  const home = await tempRoot('dsh-unit-claim-')
  const io = nodeEvolutionIo()
  const port = targetClaimUnitPort(io, home, () => 1000)
  const claim = await port.acquire('alpha', 'run-1')
  await expect(port.acquire('alpha', 'run-2')).rejects.toThrow('target-claim-busy')
  await claim.release()
  const again = await port.acquire('alpha', 'run-3')
  await again.release()
})
