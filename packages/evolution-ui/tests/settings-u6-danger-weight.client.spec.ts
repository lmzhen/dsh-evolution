// @tier pre-tag
// @vitest-environment jsdom
/**
 * U-6 (G5.5): the weight of a dangerous action. Approve/reject/preview used to be three identical
 * buttons — same class, no tone, no primary — while the family already had the convention for the other
 * one (the save button carries `data-primary`). Under DecisionFrame the contract is stronger: exactly
 * one primary, and reject/preview are secondary even though they remain visible.
 *
 * Judge ③ of the finding ("approve is disabled while the row is busy") is NOT re-pinned here:
 * `PendingCard.client.spec.ts` already drives that path through the card's real state machine (the
 * held-promise case), and a second mount of the same behaviour would only be a slower copy.
 *
 * Mounted through the card's REAL face (`{ t, api }`, async `pending()`): an invented `state` prop
 * renders an empty card and every query then passes vacuously.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ApprovalApi, PendingRow } from '../src/panels/settings/api.ts'
import { formatText, message, type MessageKey } from '../src/panels/settings/messages.ts'
import { PendingCard } from '../src/panels/settings/PendingCard.ts'

const row: PendingRow = {
  id: 'p-1', kind: 'skill', summary: 'patch skill "alpha"',
  createdAt: '2026-09-30T00:00:00.000Z', age: { unit: 'minutes', n: 3 }, status: 'pending',
}

const windowStub = (waiting: readonly PendingRow[]) =>
  async (status?: string) => ({ ok: true as const, data: status === 'executing' ? [] : waiting })

const api: ApprovalApi = {
  pending: windowStub([row]),
  approve: async () => ({ ok: true, data: null }),
  reject: async () => ({ ok: true, data: null }),
  preview: async () => ({ ok: true, data: { available: false, reason: 'no preview in this fixture' } }),
}

const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]
const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values)

afterEach(() => { cleanup() })

describe('U-6: a dangerous action carries its weight', () => {
  it('renders one primary and two secondary decisions', async () => {
    const view = render(h(PendingCard, { t, api }))
    await waitFor(() => { expect(screen.getByText(message('approvalApprove'))).toBeDefined() })
    expect(view.container.querySelectorAll('[data-role="decision-primary"]').length).toBe(1)
    expect(view.container.querySelector('[data-role="decision-primary"]')?.textContent).toBe(message('approvalApprove'))
    expect(view.container.querySelectorAll('[data-role="decision-secondary"]').length).toBe(2)
  })
})
