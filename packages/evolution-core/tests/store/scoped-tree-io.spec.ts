// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '../../src/io.ts'
import { HomeFence } from '../../src/home-fence.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { createStoreService } from '../../src/store/service.ts'
import { scopedTreeIO, mergeIoIfV2 } from '../../src/store/scoped-tree-io.ts'
import { StoreActivationPendingError } from '../../src/store/activation-guard.ts'
import { STATE_V2_MIGRATION_MARKER } from '../../src/state/constants.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

describe('scoped tree IO bridge', () => {
  it('maps run-meta/report files into domains and delegates dot locks', async () => {
    const home = await tempRoot('dsh-scoped-tree-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home, fence: new HomeFence({ home }) })
    await kernel.bootstrap({ mergeMeta: {}, reports: {} })
    const scoped = scopedTreeIO(io, {
      home,
      kernel,
      mappings: [
        { prefix: 'merge/run-meta', domain: 'mergeMeta' },
        { prefix: 'reports', domain: 'reports' },
      ],
    })
    const metaPath = join(home, 'merge', 'run-meta', 'run-1.json')
    const reportPath = join(home, 'reports', 'maintain-1.json')
    await mkdir(join(home, 'reports'), { recursive: true })
    await scoped.writeText(metaPath, '{"phase":"running"}\n')
    await scoped.writeText(reportPath, '{"ok":true}\n')
    expect(await scoped.readText(metaPath)).toBe('{"phase":"running"}\n')
    expect(await scoped.list(join(home, 'reports'))).toEqual(['maintain-1.json'])
    expect(await readFile(metaPath, 'utf8').catch(() => null)).toBeNull()
    await scoped.remove(reportPath)
    expect(await scoped.exists(reportPath)).toBe(false)

    const lock = join(home, 'reports', '.retention')
    await writeFile(lock, 'lock\n')
    await scoped.writeText(lock, 'still-base\n')
    expect(await readFile(lock, 'utf8')).toBe('still-base\n')
  })

  it('routes mapped writes through the merge surface service when supplied', async () => {
    const home = await tempRoot('dsh-scoped-tree-service-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home, fence: new HomeFence({ home }) })
    await kernel.bootstrap({ mergeMeta: {}, reports: {} })
    const service = createStoreService(kernel)
    const scoped = scopedTreeIO(io, {
      home,
      kernel,
      service,
      commandId: 'merge',
      mappings: [{ prefix: 'merge/run-meta', domain: 'mergeMeta' }],
    })
    const path = join(home, 'merge', 'run-meta', 'run-2.json')
    await scoped.writeText(path, '{"phase":"done"}\n')
    expect(await scoped.readText(path)).toBe('{"phase":"done"}\n')
    await scoped.transact(path, previous => previous === null ? null : previous.replace('done', 'transacted'))
    expect(await scoped.readText(path)).toBe('{"phase":"transacted"}\n')
    const snapshot = (await service.query('merge', ['mergeMeta'])).snapshot
    expect(snapshot.domains.mergeMeta).toMatchObject({ 'merge/run-meta/run-2.json': '{"phase":"transacted"}\n' })
  })

  it('guards legacy merge/report writes after another host activates v2', async () => {
    const home = await tempRoot('dsh-scoped-tree-guard-')
    const io = nodeEvolutionIo()
    await mkdir(join(home, 'merge'), { recursive: true })
    await mkdir(join(home, 'reports'), { recursive: true })
    await mkdir(join(home, 'state'), { recursive: true })
    const bridge = mergeIoIfV2(undefined, io, home, new HomeFence({ home }))
    expect(bridge).not.toBeUndefined()
    const statePath = join(home, 'merge', 'merge-state.json')
    const reportPath = join(home, 'reports', 'maintain-1.json')
    const skillPath = join(home, 'skills', 'demo', 'SKILL.md')
    await bridge!.writeText(statePath, 'v1\n')
    await writeFile(join(home, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    await expect(bridge!.writeText(statePath, 'v2\n')).rejects.toBeInstanceOf(StoreActivationPendingError)
    await expect(bridge!.writeText(reportPath, 'v2\n')).rejects.toBeInstanceOf(StoreActivationPendingError)
    await bridge!.writeText(skillPath, 'tree stays writable\n')
    expect(await bridge!.readText(skillPath)).toBe('tree stays writable\n')
  })
})
