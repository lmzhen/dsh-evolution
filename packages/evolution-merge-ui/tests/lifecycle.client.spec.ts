// @tier fast
// @vitest-environment happy-dom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'
import { MergePanel } from '../src/client/Panel.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'

const view = (): MergeViewPayload => ({ counts: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0, tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 0 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }], commands: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false, approval: { mergeApproval: false } })
const source: MergeSource = {
  view: async () => ({ ok: true, payload: view() }) as MergeOutcome<MergeViewPayload>,
  rows: async (queue): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue, expiredOnly: false, items: [] as MergeRowView[], counts: view().counts } }),
  body: async (): Promise<MergeOutcome<MergeBody>> => ({ ok: true, payload: { name: 'a', side: 'live', text: '', markdown: false, truncated: false, totalBytes: 0 } }),
  history: async (): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> => ({ ok: true, payload: { items: [] } }),
}

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLElement | undefined
afterEach(() => { root?.unmount(); root = undefined; host?.remove(); host = undefined })

it('does not dispose the shared merge store when the panel unmounts', async () => {
  const store = new MergeStore(source)
  const dispose = vi.spyOn(store, 'dispose')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root?.render(createElement(MergePanel, { store, t: (key: string) => key })) })
  await act(async () => { root?.unmount() })
  root = undefined
  expect(dispose).not.toHaveBeenCalled()
  expect(() => store.start()).not.toThrow()
})
