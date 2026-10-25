// @tier fast
import { describe, expect, it, vi } from 'vitest'
import type { MergeBody, MergeHistoryItem, MergeOutcome, MergeRowView, MergeViewPayload, QueuePage } from '../src/client/api.ts'
import { MergeStore, type MergeSource } from '../src/client/MergeStore.ts'

const view = (): MergeViewPayload => ({
  counts: { verify: 0, pending: 1, fuse: 0, skipped: 0 }, expired: 0,
  tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 1 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }],
  commands: [], startCommands: { scan: 's', pair: 'p' }, notes: [], degraded: false, approval: { mergeApproval: false },
})
const row = (id: string): MergeRowView => ({
  id, pairKey: id, a: 'a', b: 'b', state: 'pending', queue: 'pending', stage: null, label: id,
  updatedAt: '2026-01-01T00:00:00.000Z', actions: [],
})
const problem = (code: 'server' | 'body-missing') => ({ kind: 'problem' as const, code, status: 500 })
const source = (overrides: Partial<MergeSource> = {}): MergeSource => ({
  view: vi.fn(async () => ({ ok: true, payload: view() } as MergeOutcome<MergeViewPayload>)),
  rows: vi.fn(async (_queue, _cursor, _expired): Promise<MergeOutcome<QueuePage>> => ({ ok: true, payload: { queue: 'pending', expiredOnly: false, items: [row('r1')], counts: view().counts } })),
  body: vi.fn(async (): Promise<MergeOutcome<MergeBody>> => ({ ok: true, payload: { name: 'a', side: 'live', text: 'body', markdown: false, truncated: false, totalBytes: 4 } })),
  history: vi.fn(async (): Promise<MergeOutcome<{ items: MergeHistoryItem[] }>> => ({ ok: true, payload: { items: [] } })),
  ...overrides,
})

describe('MergeStore', () => {
  it('keys rows by queue and expiredOnly and does not show a stale tab response', async () => {
    let resolvePending: ((value: MergeOutcome<QueuePage>) => void) | undefined
    let resolveFuse: ((value: MergeOutcome<QueuePage>) => void) | undefined
    const rows = vi.fn((queue: string): Promise<MergeOutcome<QueuePage>> => new Promise(resolve => {
      if (queue === 'pending') resolvePending = resolve
      else resolveFuse = resolve
    }))
    const store = new MergeStore(source({ rows }))
    const pending = store.loadQueue('pending', false)
    store.select('fuse')
    resolvePending?.({ ok: true, payload: { queue: 'pending', expiredOnly: false, items: [row('old')], counts: view().counts } })
    await pending
    expect(store.read().current.status).toBe('loading')
    resolveFuse?.({ ok: true, payload: { queue: 'fuse', expiredOnly: false, items: [row('new')], counts: view().counts } })
    await Promise.resolve()
    expect(store.read().current.rows.map(item => item.id)).toEqual(['new'])
    expect(store.read().queue).toBe('fuse')
  })

  it('keeps body/history errors local to the overlay', async () => {
    const store = new MergeStore(source({ body: vi.fn(async () => ({ ok: false, failure: problem('body-missing') } as MergeOutcome<MergeBody>)) }), { view: view(), rows: [row('r1')] })
    await store.openBody('a', 'live')
    expect(store.read().overlay).toMatchObject({ kind: 'body', status: 'error' })
    expect(store.read().viewState).toBe('ready')
    expect(store.read().current.rows).toHaveLength(1)
  })

  it('moves the whole panel to blocked and clears rows', async () => {
    const store = new MergeStore(source({ view: vi.fn(async () => ({ ok: false, failure: { kind: 'blocked', code: 'merge-state-blocked', readiness: { code: 'merge-state-migration-blocked', message: 'raw' } } } as MergeOutcome<MergeViewPayload>)) }), { view: view(), rows: [row('r1')] })
    await store.loadView()
    expect(store.read().viewState).toBe('blocked')
    expect(store.read().current.rows).toEqual([])
  })

  it('appends pages with an opaque cursor', async () => {
    const pages = new Map<string | undefined, QueuePage>([
      [undefined, { queue: 'pending', expiredOnly: false, items: [row('p1')], counts: view().counts, nextCursor: 'cursor-2' }],
      ['cursor-2', { queue: 'pending', expiredOnly: false, items: [row('p2')], counts: view().counts }],
    ])
    const rows = vi.fn(async (_queue, cursor) => ({ ok: true, payload: pages.get(cursor)! } as MergeOutcome<QueuePage>))
    const store = new MergeStore(source({ rows }))
    await store.loadQueue('pending', false)
    store.loadMore()
    await Promise.resolve()
    expect(store.read().current.rows.map(item => item.id)).toEqual(['p1', 'p2'])
    expect(rows).toHaveBeenCalledWith('pending', 'cursor-2', false)
  })

  it('switches to empty and ready without overlap', async () => {
    const store = new MergeStore(source({ rows: vi.fn(async () => ({ ok: true, payload: { queue: 'pending', expiredOnly: false, items: [], counts: view().counts } } as MergeOutcome<QueuePage>)) }))
    await store.loadQueue('pending', false)
    expect(store.read().current.status).toBe('empty')
  })
})
