// @tier fast
// @vitest-environment happy-dom

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'
import { MergePanel, saveSetting } from '../src/client/Panel.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'
import type { ConfigFormLike } from '../src/client/seam.ts'

class FakeForm implements ConfigFormLike {
  value: Record<string, unknown>
  writable = true
  calls: [string, unknown][] = []
  private listeners = new Set<() => void>()
  private snapshot: ReturnType<FakeForm['snapshotOf']>
  constructor(value: Record<string, unknown>) { this.value = value; this.snapshot = this.snapshotOf() }
  private snapshotOf() { return { status: 'ready' as const, value: this.value, writable: this.writable } }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async set(field: string, value: unknown): Promise<boolean> { this.calls.push([field, value]); this.value = { ...this.value, [field]: value }; this.snapshot = this.snapshotOf(); for (const listener of this.listeners) listener(); return true }
  async unset(field: string): Promise<boolean> { this.calls.push([field, undefined]); this.value = { ...this.value, [field]: undefined }; this.snapshot = this.snapshotOf(); for (const listener of this.listeners) listener(); return true }
}
const view = (capability = true): MergeViewPayload => ({
  counts: { verify: 0, pending: 0, fuse: 0, skipped: 0 }, expired: 0,
  tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 0 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }],
  commands: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false,
  approval: { mergeApproval: false, platformWrite: { enabled: false, capability } },
})
const source = (capability = true): MergeSource => ({
  view: async () => ({ ok: true, payload: view(capability) } as MergeOutcome<MergeViewPayload>),
  rows: async (queue): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue, expiredOnly: false, items: [] as MergeRowView[], counts: view().counts } }),
  body: async (): Promise<MergeOutcome<MergeBody>> => ({ ok: true, payload: { name: 'a', side: 'live', text: '', markdown: false, truncated: false, totalBytes: 0 } }),
  history: async (): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> => ({ ok: true, payload: { items: [] } }),
})
let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => { root?.unmount(); root = undefined; host?.remove(); host = undefined; vi.unstubAllGlobals() })

async function mount(settings: { merge?: FakeForm; platform?: FakeForm }, capability = true): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const store = new MergeStore(source(capability), { view: view(capability), rows: [] })
  await act(async () => { root?.render(createElement(MergePanel, { store, t: key => key, settings })) })
  return host
}

it('saves mergeApproval through the platform settings form', async () => {
  const merge = new FakeForm({ mergeApproval: false })
  const platform = new FakeForm({ enabled: false })
  const el = await mount({ merge, platform })
  const input = el.querySelector('input[data-field="mergeApproval"]') as HTMLInputElement
  expect(input).toBeTruthy()
  expect(input.disabled).toBe(false)
  await act(async () => { input.click() })
  expect(merge.calls).toEqual([['mergeApproval', true]])
  expect(el.querySelector('[data-role="settings-save-state"]')?.textContent).toContain('settings.saved')
  expect(el.querySelector('input[data-field="mergeApproval"]')?.getAttribute('data-value')).toBe('on')
  expect(el.querySelector('input[data-field="enabled"]')).toBeNull()
  expect(platform.calls).toEqual([])
})

it('renders mergeApproval and platformWrite as two independent owner rows', async () => {
  const el = await mount({ merge: new FakeForm({ mergeApproval: false }), platform: new FakeForm({ enabled: false }) })
  const sections = [...el.querySelectorAll('[data-role="settings-section"]')]
  expect(sections.map(node => node.getAttribute('data-section'))).toEqual(['merge-approval', 'platform-write'])
  expect(sections[0]?.querySelector('[data-role="settings-label"]')?.textContent).toBe('settings.mergeApproval')
  expect(sections[1]?.querySelector('[data-role="settings-label"]')?.textContent).toBe('settings.platformWrite')
  expect(el.querySelector('[data-role="settings-hint"]')?.textContent).toBe('settings.hint')
  expect(el.querySelector('[data-role="settings-readonly"]')?.textContent).toBe('settings.live')
})

it('disables platformWrite when capability is false and never derives it from mergeApproval', async () => {
  const merge = new FakeForm({ mergeApproval: true })
  const platform = new FakeForm({ enabled: true })
  const el = await mount({ merge, platform }, false)
  const section = el.querySelector('[data-section="platform-write"]')
  expect(section?.getAttribute('data-disabled')).toBe('true')
  expect(el.querySelector('input[data-field="enabled"]')).toBeNull()
  expect(merge.calls).toEqual([])
})

it('saveSetting returns the host verdict', async () => {
  const form = new FakeForm({})
  expect(await saveSetting(form, 'enabled', true)).toBe(true)
  expect(form.calls).toEqual([['enabled', true]])
})
