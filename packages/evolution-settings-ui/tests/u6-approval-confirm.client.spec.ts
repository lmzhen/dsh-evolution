// @tier pre-tag
// @vitest-environment jsdom
/**
 * U-6 (G5.13): the registry can put a NAMED confirmation in front of the destructive side.
 *
 * 31 号 §U-6 的 改法 is "回退的确认默认走原地二次点击 … 把 RiskConfirmation 作为可配门", and its 风险 line
 * pins the default: an approval batch must NOT be interrupted by a prompt nobody asked for. Three
 * judges, all here: `auto` decides on ONE click; `ask` arms the first click and NAMES the write;
 * backing out writes nothing.
 *
 * The card drives its REAL face with the file's own translator, and the named sentence lives in its
 * own element — so this asserts on a pure text node rather than on a paragraph shared with buttons.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ApprovalApi, PendingRow } from '../src/client/api.ts'
import { formatText, type MessageKey } from '../src/client/messages.ts'
import { PendingCard, confirmModeFrom, type PendingCardFace } from '../src/client/PendingCard.ts'

/** One row, the shape the pending window reports. */
const row = (over: Partial<PendingRow> = {}): PendingRow => ({
  id: 'p-1',
  kind: 'skill',
  summary: 'patch skill "alpha"',
  createdAt: '2026-09-30T00:00:00.000Z',
  age: { unit: 'minutes', n: 3 },
  status: 'pending',
  ...over,
})

/** The waiting window (the card reads BOTH windows, so answering one list twice is not a window). */
const windowStub = (waiting: readonly PendingRow[]) =>
  async (status?: string) => ({ ok: true as const, data: status === 'executing' ? [] : waiting })

/** `createElement` narrowed for the renderer (this package carries its own minimal ambient React surface). */
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

/** One face over a scripted api, with the gate mode the registry would report. */
function face(api: Partial<ApprovalApi>, mode: 'auto' | 'ask' | 'timeout'): PendingCardFace {
  const complete: ApprovalApi = {
    pending: windowStub([row()]),
    approve: async () => ({ ok: true, data: null }),
    reject: async () => ({ ok: true, data: null }),
    preview: async () => ({ ok: true, data: { available: false, reason: 'no preview in this fixture' } }),
    ...api,
  }
  return {
    t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => formatText(key, values),
    api: complete,
    confirmMode: () => mode,
  }
}

/** The sentence the operator must read before the second click. */
const named = (): string => formatText('approvalConfirmNamed', { n: row().summary })

afterEach(() => { cleanup() })

describe('U-6: the approval confirmation gate (registry approvalConfirm)', () => {
  it('reads the gate word out of a user layer, defaulting to auto for anything else (P2-11)', () => {
    // The reader the entry wires into the card's face. One definition, exported, so the mapping is
    // judgeable without mounting the plugin entry — the review found this path had no case at all.
    expect(confirmModeFrom({ approvalConfirm: 'ask' })).toBe('ask')
    expect(confirmModeFrom({ approvalConfirm: 'timeout' })).toBe('timeout')
    expect(confirmModeFrom({ approvalConfirm: 'auto' })).toBe('auto')
    // Defaults: no user layer, an empty one, junk, or a value a FUTURE version might write.
    expect(confirmModeFrom(undefined)).toBe('auto')
    expect(confirmModeFrom({})).toBe('auto')
    expect(confirmModeFrom(null)).toBe('auto')
    expect(confirmModeFrom('ask')).toBe('auto')
    expect(confirmModeFrom({ approvalConfirm: 'ASK' })).toBe('auto')
    expect(confirmModeFrom({ approvalConfirm: 'always' })).toBe('auto')
  })

  it('auto (the shipped default) decides on ONE click and shows no confirmation', async () => {
    const approve = vi.fn(async () => ({ ok: true as const, data: null }))
    render(h(PendingCard, face({ approve }, 'auto')))
    fireEvent.click(await screen.findByText(formatText('approvalApprove')))
    await waitFor(() => { expect(approve).toHaveBeenCalledWith('p-1') })
    expect(screen.queryByText(named())).toBeNull()
  })

  it('ask arms the first click, names the write, and only the second click decides', async () => {
    const approve = vi.fn(async () => ({ ok: true as const, data: null }))
    render(h(PendingCard, face({ approve }, 'ask')))
    fireEvent.click(await screen.findByText(formatText('approvalApprove')))
    // Armed, not decided — and the sentence names THIS write.
    expect(approve).not.toHaveBeenCalled()
    expect(await screen.findByText(named())).toBeDefined()
    // Backing out writes nothing and clears the armed row.
    fireEvent.click(screen.getByText(formatText('approvalConfirmNo')))
    expect(approve).not.toHaveBeenCalled()
    expect(screen.queryByText(named())).toBeNull()
    // Through the armed row this time: arm, then confirm.
    fireEvent.click(screen.getByText(formatText('approvalApprove')))
    const confirm = document.querySelector('[data-confirm="yes"]') as HTMLElement | null
    expect(confirm).not.toBeNull()
    fireEvent.click(confirm as HTMLElement)
    await waitFor(() => { expect(approve).toHaveBeenCalledWith('p-1') })
  })
})
