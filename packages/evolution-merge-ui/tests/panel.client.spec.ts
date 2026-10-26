// @tier fast
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'
import { MergePanel } from '../src/client/Panel.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'
import { en, zh } from '../src/client/messages.ts'

const t = (key: string): string => key
const view = (): MergeViewPayload => ({
  counts: { verify: 0, pending: 2, fuse: 1, skipped: 0 }, expired: 1,
  tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 2 }, { queue: 'fuse', count: 1 }, { queue: 'skipped', count: 0 }],
  commands: ['/evolution merge status'], startCommands: { scan: '/evolution merge scan', pair: '/evolution merge pair <a> <b>' },
  notes: [], degraded: false, approval: { mergeApproval: true, platformWrite: { enabled: false, capability: true } },
  latestRun: { id: 'run-1', state: 'succeeded', stage: 'commit', progress: { done: 2, total: 2 }, startedAt: 1, endedAt: 2, resultRef: '/home/reports/run-1.json', failure: { stage: 'settle', code: 'run-failed', retryable: false }, actions: [{ id: 'report', command: '/evolution merge report run-1', confirm: false, enabled: true }] },
})
const row = (): MergeRowView => ({
  id: 'mr_pending', pairKey: 'mr_pending', a: 'alpha', b: 'beta', state: 'pending', queue: 'pending', stage: null, label: 'alpha + beta',
  updatedAt: '2026-01-01T00:00:00.000Z', target: 'alpha', targetActual: 'alpha-v2', summary: { a: 'alpha summary', b: null, rationale: 'because' },
  stageView: { state: 'lost', expiresAt: 1_800_000_000_000 }, bodies: [{ name: 'alpha', side: 'live' }, { name: 'beta', side: 'archive' }],
  actions: [{ id: 'approve', command: '/evolution merge approve mr_pending', confirm: false, enabled: true }, { id: 'reject', command: '/evolution merge reject mr_pending', confirm: true, enabled: true, disabledReason: 'unavailable' }],
  createdAt: 1, updatedAt: 2,
})
const source = (overrides: Partial<MergeSource> = {}): MergeSource => ({
  view: async () => ({ ok: true, payload: view() } as MergeOutcome<MergeViewPayload>),
  rows: async (queue): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue, expiredOnly: false, items: [row()], counts: view().counts } }),
  body: async (): Promise<MergeOutcome<MergeBody>> => ({ ok: true, payload: { name: 'alpha', side: 'live', text: 'body', markdown: false, truncated: false, totalBytes: 4 } }),
  history: async (): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> => ({ ok: true, payload: { items: [] } }),
  ...overrides,
})
const render = (store: MergeStore): string => renderToStaticMarkup(createElement(MergePanel, { store, t }))

it('renders four tabs, settings, run strip, pending id/three sentences and stage lost', () => {
  const expired = { ...row(), id: 'mr_expired', stageView: { state: 'expired' as const } }
  const html = render(new MergeStore(source(), { view: view(), rows: [row(), expired] }))
  expect(html).toContain('data-state="ready"')
  expect(html).toContain('tab.pending 2')
  expect(html).toContain('data-role="settings-card"')
  expect(html).toContain('data-section="merge-approval"')
  expect(html).toContain('data-value="on"')
  expect(html).toContain('data-section="platform-write"')
  expect(html).toContain('data-value="off"')
  expect(html).toContain('data-role="run-strip"')
  expect(html).toContain('data-role="run-ended"')
  expect(html).toContain('data-role="run-failure"')
  expect(html).toContain('data-role="run-report"')
  expect(html).toContain('data-role="run-result-ref"')
  expect(html).toContain('title="/home/reports/run-1.json"')
  expect(html).toContain('data-role="row-id"')
  expect(html).toContain('mr_pending')
  expect(html).toContain('row.summaryA')
  expect(html).toContain('row.summaryB')
  expect(html).toContain('row.rationale')
  expect(html).toContain('row.noSummary')
  expect(html).toContain('row.actualTarget')
  expect(html).toContain('alpha-v2')
  expect(html).toContain('row.expires')
  expect(html).toContain('data-stage="lost"')
  expect(html).toContain('stage.state.lost')
  expect(html).toContain('data-stage="expired"')
  expect(html).toContain('stage.state.expired')
  expect(html).toContain('data-role="body-a"')
  expect(html).toContain('data-role="body-b"')
  expect(html).toContain('data-disabled-reason="unavailable"')
  expect(html).toContain('data-role="tab"')
})

it('renders four tabs, the expired toggle, and pending summary only on pending rows', () => {
  const fuse = { ...row(), id: 'mr_fuse', state: 'fuse' as const, queue: 'fuse' as const, summary: undefined, stageView: undefined }
  const html = render(new MergeStore(source(), { view: view(), rows: [row(), fuse] }))
  expect((html.match(/data-role="tab"/g) ?? []).length).toBe(4)
  expect(html).toContain('data-role="expired-toggle"')
  expect((html.match(/data-role="pending-summary"/g) ?? []).length).toBe(1)
})

it('renders verify rows with verify facts and no pending summary', () => {
  const verify = { ...row(), id: 'mr_verify', state: 'verify' as const, queue: 'verify' as const, verifySubState: 'candidates' as const, summary: undefined, stageView: undefined }
  const html = render(new MergeStore(source(), { view: view(), rows: [verify], queue: 'verify' }))
  expect(html).toContain('data-row-state="verify"')
  expect(html).toContain('verify.candidates')
  expect(html).not.toContain('data-role="pending-summary"')
})

it('renders English labels without raw locale keys', () => {
  const html = renderToStaticMarkup(createElement(MergePanel, { store: new MergeStore(source(), { view: view(), rows: [row()] }), t: key => en[key] ?? key }))
  expect(html).toContain(en['title']!)
  expect(html).toContain(en['tab.pending']! + ' 2')
  expect(html).not.toContain('settings.title')
  expect(html).not.toMatch(/[\u4e00-\u9fff]/)
  for (const key of Object.keys(en).filter(item => item.includes('.'))) expect(html, key).not.toContain(key)
})

it('does not derive platformWrite from mergeApproval', () => {
  const missing = view()
  missing.approval = { mergeApproval: true }
  const html = render(new MergeStore(source(), { view: missing, rows: [row()] }))
  expect(html).toContain('data-section="platform-write"')
  expect(html).toContain('data-value="missing"')
  expect(html).toContain('settings.capabilityMissing')
})

it('shows loading before a view exists, and empty only after a ready empty page', () => {
  expect(render(new MergeStore(source()))).toContain('data-state="loading"')
  const empty = new MergeStore(source(), { view: view(), rows: [] })
  const html = render(empty)
  expect(html).toContain('data-state="empty"')
  expect(html).toContain('empty.pending')
  expect(html).toContain('data-role="empty-scope"')
  expect(html).toContain('empty.scope')
  expect(html).not.toContain('data-role="rows"')
})

it('keeps generic errors localized and raw host text in details/title', async () => {
  const store = new MergeStore(source({ view: async () => ({ ok: false, failure: { kind: 'problem', code: 'unmounted', status: 404, message: 'host raw' } } as MergeOutcome<MergeViewPayload>) }), { view: view() })
  await store.loadView()
  const html = render(store)
  expect(html).toContain('data-state="error"')
  expect(html).toContain('failureUnmounted')
  expect(html).toContain('title="host raw"')
  expect(html).toContain('data-role="failure-detail"')
  expect(html).toContain('data-role="fallback-command"')
  expect(html).toContain('/evolution merge pending')
  expect(html).not.toContain('data-role="blocked"')
})

it('renders E-323 as the capability branch with fallback commands', async () => {
  const store = new MergeStore(source({ view: async () => ({ ok: false, failure: { kind: 'problem', code: 'capability', status: 503, wireCode: 'E-323', message: 'E-323: channel unavailable' } } as MergeOutcome<MergeViewPayload>) }), { view: view() })
  await store.loadView()
  const html = render(store)
  expect(html).toContain('data-state="error"')
  expect(html).toContain('data-role="capability-failure"')
  expect(html).toContain('data-error-code="capability"')
  expect(html).toContain('failureCapability')
  expect(html).toContain('failureCapabilityHint')
  expect(html).toContain('data-role="fallback-command"')
  expect(html).toContain('/evolution doctor')
})

it('renders blocked without rows/actions and keeps raw text in details', async () => {
  const readiness = { code: 'merge-state-migration-blocked', message: 'host raw blocked' }
  const store = new MergeStore(source({ view: async () => ({ ok: false, failure: { kind: 'blocked', code: 'merge-state-blocked', readiness } } as MergeOutcome<MergeViewPayload>) }), { view: view(), rows: [row()] })
  await store.loadView()
  const html = render(store)
  expect(html).toContain('data-state="blocked"')
  expect(html).toContain('data-role="blocked"')
  expect(html).toContain('blocked.reason.migration-blocked')
  expect(html).toContain('title="host raw blocked"')
  expect(html).not.toContain('data-role="rows"')
  expect(html).not.toContain('data-role="row-action"')
})

it('keeps body and history errors inside the overlay', async () => {
  const store = new MergeStore(source({ body: async () => ({ ok: false, failure: { kind: 'problem', code: 'body-missing', status: 200, message: 'missing' } } as MergeOutcome<MergeBody>) }), { view: view(), rows: [row()] })
  await store.openBody('alpha', 'live')
  const html = render(store)
  expect(html).toContain('data-state="ready"')
  expect(html).toContain('data-role="overlay"')
  expect(html).toContain('failureBodyMissing')
  expect(html).toContain('data-role="rows"')
  const emptyStore = new MergeStore(source({ body: async () => ({ ok: true, payload: { name: 'alpha', side: 'live', text: '', markdown: false, truncated: false, totalBytes: 0 } } as MergeOutcome<MergeBody>) }), { view: view(), rows: [row()] })
  await emptyStore.openBody('alpha', 'live')
  const emptyHtml = render(emptyStore)
  expect(emptyHtml).toContain('data-role="body-empty"')
  expect(emptyHtml).toContain('body.empty')
  expect(emptyHtml).not.toContain('data-role="body-text"')
  const ambiguousStore = new MergeStore(source({ body: async () => ({ ok: false, failure: { kind: 'problem', code: 'body-ambiguous', status: 400, message: 'name matches multiple merge rows' } } as MergeOutcome<MergeBody>) }), { view: view(), rows: [row()] })
  await ambiguousStore.openBody('dup', 'live')
  const ambiguousHtml = render(ambiguousStore)
  expect(ambiguousHtml).toContain('failureBodyAmbiguous')
  expect(ambiguousHtml).toContain('data-role="failure-detail"')
  expect(html).toContain('data-role="rows"')
  const historyStore = new MergeStore(source({ history: async () => ({ ok: true, payload: { items: [{ name: 'a', kind: 'merged', reason: 'host reason', reasonCode: 'target-taken', lastVersion: 2, archivedAt: '2026-01-01T00:00:00.000Z' }] } } as MergeOutcome<{ items: MergeHistoryItem[] }>) }), { view: view(), rows: [] })
  await historyStore.openHistory()
  const historyHtml = renderToStaticMarkup(createElement(MergePanel, { store: historyStore, t: (key: string) => zh[key] ?? key }))
  expect(historyHtml).toContain('data-role="history-item"')
  expect(historyHtml).toContain('目标已被占用')
})
