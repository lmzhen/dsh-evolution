import { join } from 'node:path'
import { expect, it } from 'vitest'
import { MutationAuthority, authorityFrom, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core/skills'
import { tempRoot } from '../../test-support/temp-home.ts'

const BODY = (name: string): string =>
  '---' + String.fromCharCode(10)
  + 'name: ' + name + String.fromCharCode(10)
  + 'description: Fence lease regression for nested merge.' + String.fromCharCode(10)
  + '---' + String.fromCharCode(10) + String.fromCharCode(10)
  + 'Body of ' + name + '.' + String.fromCharCode(10)

it('nested commitMerge settles while the caller holds the home fence lease', async () => {
  const home = await tempRoot('dsh-merge-fence-lease-')
  const io = nodeEvolutionIo()
  const authority = new MutationAuthority({ io, home })
  const lib = new SkillLibrary(
    join(home, 'skills'),
    io,
    undefined,
    undefined,
    undefined,
    undefined,
    authorityFrom({ origin: 'foreground' }),
    authority.mutationLock,
    authority.homeFence,
  )
  await lib.create('src-a', BODY('src-a'), 'foreground')
  const sourceBody = (await lib.read('src-a')) ?? ''
  const lease = await authority.homeFence.acquire()
  try {
    const outcome = await Promise.race([
      lib.commitMerge({
        target: 'umbrella',
        targetExists: false,
        sources: ['src-a'],
        body: BODY('umbrella'),
        supportFiles: [],
        expectedTargetBody: null,
        expectedSourceBodies: [{ name: 'src-a', body: sourceBody }],
        origin: 'foreground',
        nested: true,
        summary: 'fence lease regression',
      }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 20_000)),
    ])
    expect(outcome, 'nested merge must not re-acquire the fence it already holds').not.toBeNull()
    if (outcome === null) return
    expect(outcome.ok).toBe(true)
  } finally {
    await lease.release()
  }
}, 30_000)
