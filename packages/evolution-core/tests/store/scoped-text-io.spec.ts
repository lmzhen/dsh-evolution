// @tier fast
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo, transactIo } from '../../src/io.ts'
import { HomeFence } from '../../src/home-fence.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { scopedTextIO } from '../../src/store/scoped-text-io.ts'
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

  it('only activates the merge bridge after the v2 marker exists', async () => {
    const root = await tempRoot('dsh-scoped-marker-')
    const io = nodeEvolutionIo()
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const base = nodeEvolutionIo()
    const bridge = (await import('../../src/store/scoped-text-io.ts')).mergeStateIoIfV2(undefined, base, root, new HomeFence({ home: root }))
    expect(bridge).not.toBeUndefined()
    await expect(bridge!.readText(join(root, 'merge', 'merge-state.json'))).rejects.toThrow()
  })
})

function existsFile(path: string): boolean {
  return existsSync(path)
}
