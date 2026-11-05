// @tier fast
// @vitest-environment happy-dom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'
import { MergePanel } from '../src/client/Panel.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'

const view = (): MergeViewPayload => ({
  counts: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0,
  tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 1 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }],
  commands: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false, approval: { mergeApproval: false },
})
const row = (): MergeRowView => ({
  id: 'mr_copy', pairKey: 'mr_copy', a: 'alpha', b: 'beta', state: 'pending', queue: 'pending', stage: null,
  label: 'alpha + beta', target: 'alpha',
  actions: [{ id: 'approve', command: '/evolution merge approve mr_copy', confirm: false, enabled: true }],
  createdAt: 1, updatedAt: 2,
})

it('copy failure keeps the command selectable and retries the same command', async () => {
  const writeText = vi.fn(async () => { throw new Error('denied') })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const source: MergeSource = {
    view: async () => ({ ok: true, payload: view() } as MergeOutcome<MergeViewPayload>),
    rows: async (queue): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue, expiredOnly: false, items: [row()], counts: view().counts } }),
    body: async () => ({ ok: true, payload: { name: 'alpha', side: 'live', text: 'body', markdown: false, truncated: false, totalBytes: 4 } } as MergeOutcome<never>),
    history: async () => ({ ok: true, payload: { items: [] } } as MergeOutcome<never>),
  }
  const store = new MergeStore(source, { view: view(), rows: [row()] })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(createElement(MergePanel, { store, t: key => key, decide: async () => ({ ok: true, message: '' }) })) })
  const copy = host.querySelector('[data-role="row-copy"][data-action="approve-copy"]') as HTMLButtonElement
  expect(copy).toBeTruthy()
  await act(async () => { copy.click() })
  expect(host.querySelector('[data-role="copy-failed"]')?.textContent).toContain('copyFailed')
  expect(host.querySelector('[data-role="copy-failed-command"]')?.textContent).toBe('/evolution merge approve mr_copy')
  await act(async () => { (host.querySelector('[data-role="copy-retry"]') as HTMLButtonElement).click() })
  expect(writeText).toHaveBeenCalledTimes(2)
  expect(writeText).toHaveBeenLastCalledWith('/evolution merge approve mr_copy')
  root.unmount()
  host.remove()
})
