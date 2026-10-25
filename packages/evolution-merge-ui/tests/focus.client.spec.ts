// @tier fast
// @vitest-environment happy-dom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import { afterEach, expect, it } from 'vitest'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'
import { MergePanel } from '../src/client/Panel.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'

const view = (): MergeViewPayload => ({ counts: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0, tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 0 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }], commands: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false, approval: { mergeApproval: false } })
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLElement | undefined
afterEach(() => { root?.unmount(); root = undefined; host?.remove(); host = undefined })

it('refreshes facts and the current tab on focus and visibilitychange', async () => {
  let viewCalls = 0
  let rowCalls = 0
  const source: MergeSource = {
    view: async () => { viewCalls += 1; return { ok: true, payload: view() } as MergeOutcome<MergeViewPayload> },
    rows: async (queue): Promise<MergeOutcome<QueuePage>> => { rowCalls += 1; return { ok: true, payload: { queue, expiredOnly: false, items: [] as MergeRowView[], counts: view().counts } } },
    body: async (): Promise<MergeOutcome<MergeBody>> => ({ ok: true, payload: { name: 'a', side: 'live', text: '', markdown: false, truncated: false, totalBytes: 0 } }),
    history: async (): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> => ({ ok: true, payload: { items: [] } }),
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root?.render(createElement(MergePanel, { store: new MergeStore(source), t: (key: string) => key })) })
  const initialView = viewCalls
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(viewCalls).toBeGreaterThan(initialView)
  const afterFocus = viewCalls
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(viewCalls).toBeGreaterThan(afterFocus)
})
