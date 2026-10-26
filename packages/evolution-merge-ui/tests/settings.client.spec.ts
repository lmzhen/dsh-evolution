// @tier fast
// @vitest-environment happy-dom

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'
import { MergePanel, saveSetting } from '../src/client/Panel.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'
import type { ConfigFormLike } from '../src/client/seam.ts'

it('copies row actions and honors the confirm gate on the production panel', async () => {
  const command = '/evolution merge approve mr_copy'
  const row: MergeRowView = {
    id: 'mr_copy', pairKey: 'mr_copy', a: 'alpha', b: 'beta', state: 'pending', queue: 'pending', stage: null, label: 'alpha + beta',
    updatedAt: '2026-01-01T00:00:00.000Z', bodies: [],
    actions: [{ id: 'approve', command, confirm: false, enabled: true }], createdAt: 1,
  }
  const copySource: MergeSource = { ...source(), rows: async (queue): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue, expiredOnly: false, items: [row], counts: view().counts } }) }
  const store = new MergeStore(copySource, { view: view(), rows: [row] })
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(createElement(MergePanel, { store, t: key => key })) })
  const button = host.querySelector('[data-role="row-action"]') as HTMLButtonElement
  await act(async () => { button.click() })
  expect(writeText).toHaveBeenCalledWith(command)
  root.unmount(); host.remove()
})

it('asks for confirmation before copying a confirm action', async () => {
  const command = '/evolution merge skipped --restore mr_confirm'
  const row: MergeRowView = {
    id: 'mr_confirm', pairKey: 'mr_confirm', a: 'alpha', b: 'beta', state: 'pending', queue: 'pending', stage: null, label: 'alpha + beta',
    updatedAt: '2026-01-01T00:00:00.000Z', bodies: [],
    actions: [{ id: 'restore', command, confirm: true, enabled: true }], createdAt: 1,
  }
  const confirmSource: MergeSource = { ...source(), rows: async (queue): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue, expiredOnly: false, items: [row], counts: view().counts } }) }
  const store = new MergeStore(confirmSource, { view: view(), rows: [row] })
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const confirm = vi.fn(() => false)
  Object.defineProperty(globalThis, 'confirm', { configurable: true, value: confirm })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(createElement(MergePanel, { store, t: key => key })) })
  const button = host.querySelector('[data-role="row-action"]') as HTMLButtonElement
  await act(async () => { button.click() })
  expect(confirm).toHaveBeenCalled()
  expect(writeText).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => { button.click() })
  expect(writeText).toHaveBeenCalledWith(command)
  root.unmount(); host.remove()
})

it('INSTALL states the three product axes and does not collapse them into one switch', () => {
  const candidates = [join(process.cwd(), 'packages/evolution/INSTALL.md'), join(process.cwd(), 'packages/INSTALL.md')]
  const file = candidates.find(path => existsSync(path))
  if (file === undefined) throw new Error('INSTALL.md not found in ' + candidates.join(' / '))
  const install = readFileSync(file, 'utf8')
  expect(install).toContain('three axes')
  expect(install).toContain('`mergeApproval`, `platformWrite`')
})

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
