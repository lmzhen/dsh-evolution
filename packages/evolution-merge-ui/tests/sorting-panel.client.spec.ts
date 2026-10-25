// @tier fast
// @vitest-environment happy-dom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'
import { MergePanel } from '../src/client/Panel.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'
import { rowOrderKey } from '../src/client/sorting.ts'

const t = (key: string): string => key
const view = (): MergeViewPayload => ({ counts: { verify: 0, pending: 3, fuse: 0, skipped: 0 }, expired: 0, tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 3 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }], commands: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false, approval: { mergeApproval: false } })
const row = (id: string): MergeRowView => ({ id, pairKey: id, a: 'a-' + id, b: 'b-' + id, state: 'pending', queue: 'pending', stage: null, label: 'label-' + id, updatedAt: '2026-01-01T00:00:00.000Z', actions: [], createdAt: 1 })
const rows = [row('r1'), row('r2'), row('r3')]
const source = (): MergeSource => ({
  view: async () => ({ ok: true, payload: view() } as MergeOutcome<MergeViewPayload>),
  rows: async (queue): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue, expiredOnly: false, items: rows, counts: view().counts } }),
  body: async (): Promise<MergeOutcome<MergeBody>> => ({ ok: true, payload: { name: 'a', side: 'live', text: '', markdown: false, truncated: false, totalBytes: 0 } }),
  history: async (): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> => ({ ok: true, payload: { items: [] } }),
})
let host: HTMLElement
let root: Root
beforeEach(() => { localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { root.unmount(); host.remove(); localStorage.clear() })
const order = (): string[] => [...host.querySelectorAll('[data-role="row"]')].map(el => el.getAttribute('data-row-id') ?? '')
async function mount(): Promise<void> {
  await act(async () => { root.render(createElement(MergePanel, { store: new MergeStore(source(), { view: view(), rows }), t, workspaceId: 'ws-A' })) })
  await act(async () => {})
}

it('right-click pins a row to top and persists by workspace+queue', async () => {
  await mount()
  expect(order()).toEqual(['r1', 'r2', 'r3'])
  await act(async () => { host.querySelectorAll('[data-role="row"]')[2]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })) })
  expect(host.querySelector('[data-role="sort-menu"]')).not.toBeNull()
  await act(async () => { (host.querySelector('[data-role="sort-pin-top"]') as HTMLButtonElement).click() })
  expect(order()).toEqual(['r3', 'r1', 'r2'])
  expect(JSON.parse(localStorage.getItem(rowOrderKey('ws-A', 'pending'))!)).toEqual(['r3', 'r1', 'r2'])
})

it('drops a row before its target and survives a tab switch', async () => {
  await mount()
  const before = host.querySelectorAll('[data-role="row"]')[0] as HTMLElement
  const target = host.querySelectorAll('[data-role="row"]')[2] as HTMLElement
  await act(async () => { before.dispatchEvent(new Event('dragstart', { bubbles: true })) })
  await act(async () => { target.dispatchEvent(new Event('drop', { bubbles: true })) })
  expect(order()).toEqual(['r2', 'r1', 'r3'])
  const tabs = host.querySelectorAll('[data-role="tab"]')
  await act(async () => { (tabs[0] as HTMLButtonElement).click() })
  await act(async () => { (host.querySelectorAll('[data-role="tab"]')[1] as HTMLButtonElement).click() })
  expect(order()).toEqual(['r2', 'r1', 'r3'])
  expect(JSON.parse(localStorage.getItem(rowOrderKey('ws-A', 'pending'))!)).toEqual(['r2', 'r1', 'r3'])
})
