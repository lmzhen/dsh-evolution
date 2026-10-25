// @tier fast
// @vitest-environment happy-dom

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
// The previous released UI API/Panel snapshot is a fixture, not a production
// export. It proves the new server's wireVersion=1 envelopes remain readable by
// the old UI while the new UI replaces the production files in this package.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { body, history, rows, view } from './fixtures/previous-ui/api.ts'
import { MergePanel as PreviousPanel, type MergeFace } from './fixtures/previous-ui/Panel.ts'

const answer = (payload: unknown): Response => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('previous UI api reads the new server four GET envelopes', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => answer(url.includes('/body')
    ? { wireVersion: 1, readAt: 1, name: 'alpha', side: 'live', text: '# alpha', markdown: true, truncated: false, totalBytes: 7 }
    : url.includes('/rows')
      ? { wireVersion: 1, readAt: 1, queue: 'pending', expiredOnly: false, counts: { active: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0 }, rows: [{ id: 'mr_a', state: 'pending', queue: 'pending', a: 'alpha', b: 'beta', target: { requested: 'alpha' }, actions: [{ id: 'approve', command: '/evolution merge approve mr_a', confirm: false, enabled: true }], createdAt: 1, updatedAt: 2 }], notes: [] }
      : url.includes('/history')
        ? { wireVersion: 1, readAt: 1, items: [{ name: 'alpha', kind: 'merged', reason: 'merged', lastVersion: 2, archivedAt: 1 }] }
        : { wireVersion: 1, readAt: 1, counts: { active: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0 }, active: null, last: null, approval: { mergeApproval: true }, fallback: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false })))
  const facts = await view()
  expect(facts).toMatchObject({ ok: true, payload: { counts: { pending: 1 } } })
  const page = await rows('pending')
  expect(page).toMatchObject({ ok: true, payload: { items: [{ id: 'mr_a' }] } })
  const bodyResult = await body('mr_a', 'a')
  expect(bodyResult).toMatchObject({ ok: true, payload: { content: '# alpha' } })
  const historyResult = await history()
  expect(historyResult).toMatchObject({ ok: true, payload: { items: [{ name: 'alpha', kind: 'merged' }] } })
})

it('previous UI Panel fixture still renders the frozen envelope', () => {
  const face: MergeFace = {
    view: {
      counts: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0,
      tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 1 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }],
      commands: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false, approval: true,
    },
    rows: [], t: key => key,
  }
  const html = renderToStaticMarkup(createElement(PreviousPanel, face))
  expect(html).toContain('data-state="empty"')
  expect(html).toContain('data-role="title"')
  expect(html).toContain('data-role="tabs"')
})

it('previous UI Panel still copies a row action command', async () => {
  const writes: string[] = []
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { writes.push(text) } }, configurable: true })
  const face: MergeFace = {
    view: {
      counts: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0,
      tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 1 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }],
      commands: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false, approval: true,
    },
    rows: [{ id: 'mr_a', pairKey: 'mr_a', a: 'alpha', b: 'beta', state: 'pending', queue: 'pending', stage: null, label: 'alpha + beta', updatedAt: '2026-01-01T00:00:00.000Z', actions: [{ id: 'approve', command: '/evolution merge approve mr_a', confirm: false, enabled: true }] }],
    t: key => key,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(createElement(PreviousPanel, face)) })
  const button = host.querySelector('button[data-role="row-action"][data-action="approve"]') as HTMLButtonElement
  expect(button).toBeTruthy()
  await act(async () => { button.click() })
  expect(writes).toEqual(['/evolution merge approve mr_a'])
  root.unmount()
})
