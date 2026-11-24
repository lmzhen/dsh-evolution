// @tier fast
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { HomeFence, nodeEvolutionIo, scopedTextIO, StoreKernel } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { loadMergeState, mergeStatePath } from '../src/state.ts'

describe('merge state through the MVCC text bridge', () => {
  it('reads the v3 ledger from the bridge instead of merge-state.json', async () => {
    const home = await tempRoot('dsh-merge-v2-')
    const io = nodeEvolutionIo()
    const kernel = new StoreKernel({ io, home, fence: new HomeFence({ home }) })
    await kernel.bootstrap({ merge: { text: JSON.stringify({ schemaVersion: 3, rows: [] }) + '\n' } })
    const scoped = scopedTextIO(io, { path: mergeStatePath(home), domain: 'merge', kernel })
    const loaded = await loadMergeState(scoped, home)
    expect(loaded.ok).toBe(true)
    expect(loaded.state.rows).toEqual([])
    expect(await io.exists(join(home, 'merge', 'merge-state.json'))).toBe(false)
  })
})
