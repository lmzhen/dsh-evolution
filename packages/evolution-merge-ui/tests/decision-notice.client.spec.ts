// @tier fast
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { MergePanel } from '../src/client/Panel.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'

afterEach(cleanup)

const t = (key: string): string => key
const view = (): MergeViewPayload => ({
  counts: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0,
  tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 1 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }],
  commands: ['/evolution merge status'], startCommands: { scan: '/evolution merge scan', pair: '/evolution merge pair <a> <b>' },
  notes: [], degraded: false, approval: { mergeApproval: true, platformWrite: { enabled: false, capability: true } },
  lastRun: { id: 'run-1', state: 'succeeded', stage: 'commit', progress: { done: 0, total: 0 }, startedAt: 1, endedAt: 2, actions: [] },
})
const row = (): MergeRowView => ({
  id: 'mr_pending', pairKey: 'mr_pending', a: 'alpha', b: 'beta', state: 'pending', queue: 'pending', stage: null, label: 'alpha + beta',
  updatedAt: '2026-01-01T00:00:00.000Z', target: 'alpha', summary: { a: 'alpha', b: 'beta', rationale: 'because' },
  stageView: undefined, bodies: [{ name: 'alpha', side: 'live' }],
  actions: [{ id: 'approve', command: '/evolution merge approve mr_pending', confirm: false, enabled: true }],
  createdAt: '2026-01-01T00:00:00.000Z',
})
const source = (): MergeSource => ({
  view: async () => ({ ok: true, payload: view() } as MergeOutcome<MergeViewPayload>),
  rows: async (queue): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue, expiredOnly: false, items: [row()], counts: view().counts } }),
  body: async (): Promise<MergeOutcome<MergeBody>> => ({ ok: true, payload: { name: 'alpha', side: 'live', text: 'body', markdown: false, truncated: false, totalBytes: 4 } }),
  history: async (): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> => ({ ok: true, payload: { items: [] } }),
})

describe('merge decision notice', () => {
  it('localizes a known failure code and keeps the host message as diagnostic detail', async () => {
    render(createElement(MergePanel, {
      store: new MergeStore(source(), { view: view(), rows: [row()] }),
      t,
      decide: async () => ({ ok: false, code: 'row-not-pending', message: 'host raw detail' }),
    }))
    fireEvent.click(await screen.findByRole('button', { name: 'action.approve' }))
    fireEvent.click(await screen.findByRole('button', { name: 'decision.approve' }))
    await waitFor(() => { expect(screen.getByText('decide.reason.not-pending')).toBeDefined() })
    expect(screen.getByText('host raw detail')).toBeDefined()
    expect(screen.getByText('blocked.detail')).toBeDefined()
  })

  it('falls back to the generic failure only when the code is unknown', async () => {
    render(createElement(MergePanel, {
      store: new MergeStore(source(), { view: view(), rows: [row()] }),
      t,
      decide: async () => ({ ok: false, code: 'unknown-code', message: 'raw' }),
    }))
    fireEvent.click(await screen.findByRole('button', { name: 'action.approve' }))
    fireEvent.click(await screen.findByRole('button', { name: 'decision.approve' }))
    await waitFor(() => { expect(screen.getByText('decide.failed')).toBeDefined() })
    expect(screen.getByText('raw')).toBeDefined()
  })
})

