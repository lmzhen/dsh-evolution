/**
 * The pending card's two halves that can be judged without a browser: the request mapping (every answer,
 * refusal and transport failure lands on the same shape) and the state machine (loading, empty and
 * failed are three different states — the E7 lesson, asserted here so no later edit can merge them).
 */
import { describe, expect, it, vi } from 'vitest'
import { createApprovalApi, type PendingRow } from '../src/client/api.ts'
import {
  beginAction, collapsed, endAction, expanded, failed, INITIAL_PENDING_STATE, loaded, loading, noticed, previewArrived,
} from '../src/client/pending-state.ts'
import { APPROVAL_CLIENT_ROUTES } from '../src/client/approval-routes.ts'

const row = (over: Partial<PendingRow> = {}): PendingRow => ({
  id: 'p-1',
  kind: 'skill',
  summary: 'patch skill "alpha"',
  createdAt: '2026-09-30T00:00:00.000Z',
  age: { unit: 'minutes', n: 3 },
  status: 'pending',
  ...over,
})

/** One JSON answer as a fetch response. */
const answer = (status: number, body: unknown): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as unknown as Response

describe('the approval api maps every answer onto one shape', () => {
  it('reads the pending rows and sends the two decisions as JSON POSTs', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = typeof init?.body === 'string' ? init.body : undefined
      calls.push({ url, method: init?.method ?? 'GET', ...body === undefined ? {} : { body } })
      return answer(200, { ok: true, data: [row()] })
    })
    const api = createApprovalApi(doFetch)
    const pending = await api.pending()
    await api.approve('p-1')
    await api.reject('p-2')
    await api.preview('p-3')
    expect(pending).toMatchObject({ ok: true, data: [{ id: 'p-1' }] })
    expect(calls).toEqual([
      { url: APPROVAL_CLIENT_ROUTES.pending, method: 'GET' },
      { url: APPROVAL_CLIENT_ROUTES.approve, method: 'POST', body: JSON.stringify({ id: 'p-1' }) },
      { url: APPROVAL_CLIENT_ROUTES.reject, method: 'POST', body: JSON.stringify({ id: 'p-2' }) },
      { url: APPROVAL_CLIENT_ROUTES.preview + '?id=p-3', method: 'GET' },
    ])
  })

  it('keeps the host sentence of a refusal, and names a transport failure', async () => {
    const refused = createApprovalApi(async () => answer(200, { ok: false, code: 'approval-refused', message: 'not in the pending window' }))
    expect(await refused.approve('gone')).toEqual({ ok: false, message: 'not in the pending window' })
    const broken = createApprovalApi(async () => { throw new Error('offline') })
    expect(await broken.pending()).toEqual({ ok: false, message: 'offline' })
    const http = createApprovalApi(async () => answer(500, {}))
    expect(await http.pending()).toEqual({ ok: false, message: 'HTTP 500' })
  })
})

describe('the pending card state machine', () => {
  it('starts in loading, never in empty', () => {
    expect(INITIAL_PENDING_STATE.view.kind).toBe('loading')
    expect(loading(INITIAL_PENDING_STATE).view.kind).toBe('loading')
  })

  it('separates an empty window from a read that has not answered', () => {
    expect(loaded(INITIAL_PENDING_STATE, []).view).toEqual({ kind: 'empty' })
    expect(loaded(INITIAL_PENDING_STATE, [row()]).view).toEqual({ kind: 'ready', rows: [row()] })
  })

  it('keeps the reason of a failed read and the sentence of a refusal', () => {
    expect(failed(INITIAL_PENDING_STATE, 'state medium is unreadable').view).toEqual({ kind: 'failed', message: 'state medium is unreadable' })
    const refused = noticed(beginAction(INITIAL_PENDING_STATE, 'p-1'), 'not in the pending window')
    expect(refused.notice).toBe('not in the pending window')
    expect(endAction(refused, 'p-1').busy).toEqual([])
    expect(noticed(endAction(refused, 'p-1'), null).notice).toBeNull()
  })

  it('opens one preview at a time and drops an answer for a row the reader left', () => {
    const opened = expanded(INITIAL_PENDING_STATE, 'p-1')
    expect(opened.open).toBe('p-1')
    expect(opened.preview).toEqual({ kind: 'loading' })
    const ready = previewArrived(opened, 'p-1', { kind: 'unavailable', reason: 'the target changed' })
    expect(ready.preview).toEqual({ kind: 'unavailable', reason: 'the target changed' })
    // A late answer for another row must not paint under the open one.
    expect(previewArrived(opened, 'p-2', { kind: 'loading' })).toBe(opened)
    expect(expanded(ready, 'p-2').open).toBe('p-2')
    expect(collapsed(ready)).toMatchObject({ open: null, preview: null })
  })

  it('marks only the record whose decision is in flight', () => {
    const busy = beginAction(beginAction(INITIAL_PENDING_STATE, 'p-1'), 'p-1')
    expect(busy.busy).toEqual(['p-1'])
    expect(beginAction(busy, 'p-2').busy).toEqual(['p-1', 'p-2'])
  })
})
