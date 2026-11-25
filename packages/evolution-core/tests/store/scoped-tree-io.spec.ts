// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '../../src/io.ts'
import { HomeFence } from '../../src/home-fence.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { createStoreService } from '../../src/store/service.ts'
import { scopedTreeIO } from '../../src/store/scoped-tree-io.ts'
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
    const snapshot = (await service.query('merge', ['mergeMeta'])).snapshot
    expect(snapshot.domains.mergeMeta).toMatchObject({ 'merge/run-meta/run-2.json': '{"phase":"done"}\n' })
  })
})
