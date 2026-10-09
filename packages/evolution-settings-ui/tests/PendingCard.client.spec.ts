// @vitest-environment jsdom
/**
 * The pending card RENDERED: the three states the review asked for each say so in their own words, and a
 * decision re-reads the window instead of editing the list locally.
 *
 * The state machine has its own spec; this one is about the wiring — that the loading state does not wear
 * the empty state's sentence (E7), that a row carries its kind, its summary and both decisions, and that
 * the host's refusal reaches the reader as a sentence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ApprovalApi, PendingRow } from '../src/client/api.ts'
import { message, type MessageKey } from '../src/client/messages.ts'
import { PendingCard } from '../src/client/PendingCard.ts'

const row = (over: Partial<PendingRow> = {}): PendingRow => ({
  id: 'p-1',
  kind: 'skill',
  summary: 'patch skill "alpha"',
  createdAt: '2026-09-30T00:00:00.000Z',
  age: { unit: 'minutes', n: 3 },
  status: 'pending',
  ...over,
})

/**
 * One window stub: the WAITING list, and (unless a case says otherwise) nothing running.
 *
 * The card reads both windows (T4-05/A47), so a stub that answers the same list to both is not a
 * faithful window — it renders every row twice, which is a fixture defect, not a card defect.
 * @param waiting - what the pending window holds.
 * @param running - what the executing window holds.
 * @returns the api call.
 */
function windowStub(
  waiting: readonly PendingRow[],
  running: readonly PendingRow[] = [],
): (status?: string) => Promise<{ ok: true; data: readonly PendingRow[] }> {
  return async (status?: string) => ({ ok: true as const, data: status === 'executing' ? running : waiting })
}

/** A face over a scripted api: the copy seat is the dictionary itself, so assertions name the words. */
function face(api: Partial<ApprovalApi>): { t: (key: MessageKey) => string; api: ApprovalApi } {
  const complete: ApprovalApi = {
    pending: async () => ({ ok: true, data: [] }),
    approve: async () => ({ ok: true, data: null }),
    reject: async () => ({ ok: true, data: null }),
    preview: async () => ({ ok: true, data: { available: false, reason: 'no preview in this fixture' } }),
    ...api,
  }
  return { t: (key: MessageKey) => message(key), api: complete }
}

/**
 * `createElement` narrowed for the renderer: this package carries its own minimal ambient React surface
 * (no react package in the build tree), so the element type the renderer wants is spelled here, once.
 */
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

/** Render one card. */
function mount(props: { t: (key: MessageKey) => string; api: ApprovalApi }): void {
  render(h(PendingCard, props))
}

describe('the pending card', () => {
  // ONE unmount point. The per-test `cleanup()` calls this file used to carry ran only on the success
  // path, so a failing case left its card mounted — and the next case then failed on a query that
  // matched two cards (the refresh control, a row) instead of on its own subject.
  afterEach(() => { cleanup() })

  it('shows the reading state first, never the empty state', async () => {
    let release: (() => void) | null = null
    const hold = new Promise<void>((resolve) => { release = resolve })
    const pending = vi.fn(async () => {
      await hold
      return { ok: true as const, data: [] as readonly PendingRow[] }
    })
    mount(face({ pending }))
    expect(screen.getByText(message('approvalLoading'))).toBeDefined()
    expect(screen.queryByText(message('approvalEmpty'))).toBeNull()
    release?.()
    await waitFor(() => { expect(screen.getByText(message('approvalEmpty'))).toBeDefined() })
  })

  it('renders one row with its kind, its summary and both decisions', async () => {
    mount(face({ pending: windowStub([row()]) }))
    await waitFor(() => { expect(screen.getByText('patch skill "alpha"')).toBeDefined() })
    expect(screen.getByText(message('approvalKindSkill'))).toBeDefined()
    expect(screen.getByText(message('approvalApprove'))).toBeDefined()
    expect(screen.getByText(message('approvalReject'))).toBeDefined()
  })

  it('re-reads the window after a decision instead of editing the list', async () => {
    const pending = vi.fn(windowStub([row()]))
    const approve = vi.fn(async () => ({ ok: true as const, data: null }))
    mount(face({ pending, approve }))
    await waitFor(() => { expect(screen.getByText(message('approvalApprove'))).toBeDefined() })
    fireEvent.click(screen.getByText(message('approvalApprove')))
    // One load reads BOTH windows (waiting, then running) — the re-read after a decision is the
    // second round, so the sequence says exactly which windows were asked for, and when.
    await waitFor(() => {
      expect(pending.mock.calls.map(call => call[0])).toEqual([undefined, 'executing', undefined, 'executing'])
    })
    expect(approve).toHaveBeenCalledWith('p-1')
  })

  it('opens the preview on demand: the facts, then the source lines', async () => {
    const preview = vi.fn(async () => ({
      ok: true as const,
      data: {
        available: true as const,
        path: 'SKILL.md',
        linesAdded: 1,
        linesRemoved: 1,
        truncated: false,
        hunks: [{ path: 'SKILL.md', oldText: 'b', newText: 'c' }],
      },
    }))
    mount(face({ pending: windowStub([row()]), preview }))
    await waitFor(() => { expect(screen.getByText(message('approvalPreview'))).toBeDefined() })
    fireEvent.click(screen.getByText(message('approvalPreview')))
    await waitFor(() => { expect(screen.getByText(message('approvalDiffAdded').replace('{n}', '1'))).toBeDefined() })
    expect(preview).toHaveBeenCalledWith('p-1')
    expect(screen.getByText('- b')).toBeDefined()
    expect(screen.getByText('+ c')).toBeDefined()
    // The same control closes it again.
    expect(screen.getByText(message('approvalPreviewClose'))).toBeDefined()
  })

  it('shows the host reason when a preview is unavailable', async () => {
    const preview = vi.fn(async () => ({ ok: true as const, data: { available: false as const, reason: 'the target changed after this write was staged' } }))
    mount(face({ pending: windowStub([row()]), preview }))
    await waitFor(() => { expect(screen.getByText(message('approvalPreview'))).toBeDefined() })
    fireEvent.click(screen.getByText(message('approvalPreview')))
    await waitFor(() => { expect(screen.getByText(message('approvalPreviewNone') + 'the target changed after this write was staged')).toBeDefined() })
  })

  it('audit T4-05/A47: a RUNNING record is read and shown, without the two decisions', async () => {
    const running = row({ id: 'p-2', status: 'executing', summary: 'patch skill "beta"', claimedBy: 'another session' })
    const pending = vi.fn(async (status?: string) => ({ ok: true as const, data: status === 'executing' ? [running] : [] }))
    mount(face({ pending }))
    await waitFor(() => { expect(screen.getByText('patch skill "beta"')).toBeDefined() })
    // The route has always taken ?status= — the card asked for neither window, so this record
    // was invisible here while /evolution pending and doctor both listed it.
    expect(pending.mock.calls.map(call => call[0])).toEqual([undefined, 'executing'])
    expect(screen.getByText(message('approvalExecuting'))).toBeDefined()
    expect(screen.getByText(message('approvalRunningCount').replace('{n}', '1'))).toBeDefined()
    // A running write may already have landed: offering approve here is the double-approve the
    // CLI warns about, so neither decision is rendered for this row.
    expect(screen.queryByText(message('approvalApprove'))).toBeNull()
    expect(screen.queryByText(message('approvalReject'))).toBeNull()
  })

  it('audit T5-04/A59: the window can be re-read without leaving the partition (refresh and focus)', async () => {
    let staged = false
    const pending = vi.fn(async (status?: string) => ({ ok: true as const, data: status === 'executing' || !staged ? [] : [row()] }))
    mount(face({ pending }))
    await waitFor(() => { expect(screen.getByText(message('approvalEmpty'))).toBeDefined() })
    // The session stages a write while the card is mounted: the card read exactly once before, so
    // the empty sentence stood there until the reader left the partition and came back.
    staged = true
    fireEvent.click(screen.getByText(message('approvalRefresh')))
    await waitFor(() => { expect(screen.getByText('patch skill "alpha"')).toBeDefined() })
    expect(screen.queryByText(message('approvalEmpty'))).toBeNull()
    // The window focus path (no timer: the family has no polling precedent).
    staged = false
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => { expect(screen.getByText(message('approvalEmpty'))).toBeDefined() })
  })

  it('shows the host sentence when a decision is refused', async () => {
    const approve = vi.fn(async () => ({ ok: false as const, message: 'not in the pending window' }))
    mount(face({ pending: windowStub([row()]), approve }))
    await waitFor(() => { expect(screen.getByText(message('approvalApprove'))).toBeDefined() })
    fireEvent.click(screen.getByText(message('approvalApprove')))
    await waitFor(() => { expect(screen.getByText('not in the pending window')).toBeDefined() })
  })
})
