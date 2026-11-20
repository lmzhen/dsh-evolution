import { describe, expect, it } from 'vitest'
import { MutationAuthority, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

describe('MutationAuthority keyed opt-in', () => {
  it('uses the root fence for keyless writes and target locks for keyed writes', async () => {
    const home = await tempRoot('dsh-authority-keyed-')
    let fenceAcquires = 0
    const fence = {
      holdsTree: () => false,
      acquire: async () => {
        fenceAcquires += 1
        return { release: async () => {} }
      },
    }
    const authority = new MutationAuthority({
      io: nodeEvolutionIo(),
      home,
      keyed: true,
      fence: fence as never,
    })

    await (await authority.mutationLock.acquire(['skill::a'])).release()
    expect(fenceAcquires).toBe(0)

    await (await authority.mutationLock.acquire()).release()
    expect(fenceAcquires).toBe(1)
  })

  it('keeps the root fence when keyed is not enabled', async () => {
    const home = await tempRoot('dsh-authority-root-')
    let fenceAcquires = 0
    const fence = {
      holdsTree: () => false,
      acquire: async () => {
        fenceAcquires += 1
        return { release: async () => {} }
      },
    }
    const authority = new MutationAuthority({ io: nodeEvolutionIo(), home, fence: fence as never })
    await (await authority.mutationLock.acquire(['skill::a'])).release()
    expect(fenceAcquires).toBe(1)
  })
})
