// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HomeFence } from '../../src/home-fence.ts'
import { nodeEvolutionIo } from '../../src/io.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { usageSidecarIoIfV2 } from '../../src/store/scoped-text-io.ts'
import { emptyRecord, mutateUsage, usageFile } from '../../src/usage.ts'
import { STATE_V2_MIGRATION_MARKER } from '../../src/state/constants.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

describe('usage sidecar v2 adapter', () => {
  it('writes usage through the v2 domain instead of another file', async () => {
    const home = await tempRoot('dsh-usage-sidecar-')
    const skillsRoot = join(home, 'skills')
    await mkdir(join(home, 'state'), { recursive: true })
    await mkdir(skillsRoot, { recursive: true })
    await writeFile(join(home, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home, fence: new HomeFence({ home }) })
    await kernel.bootstrap({ usage: { text: '{"version":1,"skills":{}}' }, suppressed: { text: '{"version":1,"names":[]}' } })
    const scoped = usageSidecarIoIfV2(undefined, io, skillsRoot, { home, fence: new HomeFence({ home }) })
    expect(scoped).not.toBeUndefined()
    await mutateUsage(skillsRoot, scoped!, map => { map.set('demo', { ...emptyRecord(), use_count: 1 }) })
    expect((await kernel.query(['usage'])).domains.usage).not.toEqual({ text: '{"version":1,"skills":{}}' })
    expect(await io.exists(usageFile(skillsRoot))).toBe(false)
  })
})
