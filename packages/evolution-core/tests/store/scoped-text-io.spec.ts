// @tier fast
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo, transactIo } from '../../src/io.ts'
import { HomeFence } from '../../src/home-fence.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { StoreActivationPendingError } from '../../src/store/activation-guard.ts'
import { createStoreService } from '../../src/store/service.ts'
import { memoryIoIfV2, scopedTextIO, discoveryIoIfV2 } from '../../src/store/scoped-text-io.ts'
import { STATE_V2_MIGRATION_MARKER } from '../../src/state/constants.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

describe('scoped text IO bridge', () => {
  it('maps one file path to one MVCC domain and delegates every other path', async () => {
    const root = await tempRoot('dsh-scoped-text-')
    const io = nodeEvolutionIo()
    const fence = new HomeFence({ home: root })
    const kernel = new StoreKernel({ io, home: root, fence })
    const statePath = join(root, 'merge', 'merge-state.json')
    await mkdir(join(root, 'merge'), { recursive: true })
    await kernel.bootstrap({ merge: { text: JSON.stringify({ schemaVersion: 3, rows: [] }) } })
    const scoped = scopedTextIO(io, { path: statePath, domain: 'merge', kernel })
    expect(await scoped.readText(statePath)).toContain('"schemaVersion":3')
    await transactIo(scoped, statePath, current => {
      expect(current).toContain('"schemaVersion":3')
      return JSON.stringify({ schemaVersion: 3, rows: [{ id: 'row-1' }] }) + '\n'
    })
    expect((await kernel.query(['merge'])).domains.merge).toEqual({ text: JSON.stringify({ schemaVersion: 3, rows: [{ id: 'row-1' }] }) + '\n' })
    expect(existsFile(statePath)).toBe(false)
    await scoped.writeText(join(root, 'reports', 'x.json'), '{"ok":true}\n')
    expect(await readFile(join(root, 'reports', 'x.json'), 'utf8')).toBe('{"ok":true}\n')
  })

  it('exposes the commit revision as mtime for domain-backed files', async () => {
    const root = await tempRoot('dsh-scoped-mtime-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home: root, fence: new HomeFence({ home: root }) })
    const path = join(root, 'merge', 'merge-state.json')
    await mkdir(join(root, 'merge'), { recursive: true })
    await kernel.bootstrap({ merge: { text: 'v1' } })
    const scoped = scopedTextIO(io, { path, domain: 'merge', kernel })
    const first = await scoped.mtime!(path)
    expect(first).not.toBeNull()
    await kernel.mutate({ domains: ['merge'], source: 'command', change: () => ({ merge: { text: 'v2' } }) })
    const second = await scoped.mtime!(path)
    expect(second).not.toBe(first)
  })

  it('only activates the merge bridge after the v2 marker exists', async () => {
    const root = await tempRoot('dsh-scoped-marker-')
    const io = nodeEvolutionIo()
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const base = nodeEvolutionIo()
    const bridge = (await import('../../src/store/scoped-tree-io.ts')).mergeIoIfV2(undefined, base, root, new HomeFence({ home: root }))
    expect(bridge).not.toBeUndefined()
    await expect(bridge!.readText(join(root, 'merge', 'merge-state.json'))).rejects.toThrow()
  })

  it('fails closed when a mapped domain has the wrong shape', async () => {
    const root = await tempRoot('dsh-scoped-text-corrupt-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home: root, fence: new HomeFence({ home: root }) })
    await kernel.bootstrap({ merge: { notText: true } })
    const scoped = scopedTextIO(io, { path: join(root, 'merge', 'merge-state.json'), domain: 'merge', kernel })
    await expect(scoped.readText(join(root, 'merge', 'merge-state.json'))).rejects.toThrow(/not a \{text\} document|no string text/)
  })

  it('routes memory files through the memory service when supplied', async () => {
    const root = await tempRoot('dsh-scoped-memory-')
    const io = nodeEvolutionIo()
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const fence = new HomeFence({ home: root })
    const kernel = new StoreKernel({ io, home: root, fence })
    await kernel.bootstrap({ memoryFile: { text: 'old\n' }, userFile: { text: 'user\n' } })
    const scoped = memoryIoIfV2(undefined, io, root, join(root, 'memories'), fence, createStoreService(kernel))
    expect(scoped).not.toBeUndefined()
    await scoped!.writeText(join(root, 'memories', 'MEMORY.md'), 'new\n')
    expect(await scoped!.readText(join(root, 'memories', 'MEMORY.md'))).toBe('new\n')
    expect((await kernel.query(['memoryFile'])).domains.memoryFile).toEqual({ text: 'new\n' })
  })

  it('guards the legacy memory bridge when another host activates v2', async () => {
    const root = await tempRoot('dsh-scoped-memory-guard-')
    const io = nodeEvolutionIo()
    await mkdir(join(root, 'memories'), { recursive: true })
    await mkdir(join(root, 'state'), { recursive: true })
    const scoped = memoryIoIfV2(undefined, io, root, join(root, 'memories'))
    await scoped!.writeText(join(root, 'memories', 'MEMORY.md'), 'legacy\n')
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    await expect(scoped!.writeText(join(root, 'memories', 'MEMORY.md'), 'lost\n')).rejects.toBeInstanceOf(StoreActivationPendingError)
    expect(await scoped!.readText(join(root, 'memories', 'MEMORY.md'))).toBe('legacy\n')
  })

  it('guards the discovery bridge after another host activates v2', async () => {
    const root = await tempRoot('dsh-discovery-guard-')
    const io = nodeEvolutionIo()
    await mkdir(join(root, 'state'), { recursive: true })
    await mkdir(join(root, 'discovery'), { recursive: true })
    const paths = {
      domainMap: join(root, 'discovery', 'domain-map.json'),
      projectionJournal: join(root, 'discovery', 'projection-journal.json'),
      viewSnapshots: join(root, 'discovery', 'view-snapshots.json'),
    }
    const scoped = discoveryIoIfV2(undefined, io, root, paths)
    await scoped!.writeText(paths.domainMap, '{}\n')
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    await expect(scoped!.writeText(paths.domainMap, '{"changed":true}\n')).rejects.toBeInstanceOf(StoreActivationPendingError)
    expect(await scoped!.readText(paths.domainMap)).toBe('{}\n')
  })
})

function existsFile(path: string): boolean {
  return existsSync(path)
}
