// @tier pre-tag
// @vitest-environment jsdom
/**
 * U-7 (G5.6): the accessibility baseline the platform gives for free. Two judges, both assertable:
 * ① no `:focus` rule may skip `-visible` (keyboard-only focus, never a mouse ring), and
 * ② a branch that reports a state change must expose a live region, or a screen reader never hears it.
 */
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { CSS } from '../src/client/styles.ts'
import { formatText, message, type MessageKey } from '../src/client/messages.ts'
import { PendingCard } from '../src/client/PendingCard.ts'
import type { ApprovalApi } from '../src/client/api.ts'

describe('U-7: the free accessibility baseline', () => {
  it('every focus ring is :focus-visible', () => {
    const offenders = CSS.split('\n')
      .filter(line => line.includes(':focus') && !line.includes(':focus-visible'))
    expect(offenders).toEqual([])
  })

  it('a state change reaches a live region (role=status)', async () => {
    const api: ApprovalApi = {
      pending: async () => ({ ok: true, data: [] }),
      approve: async () => ({ ok: true, data: null }),
      reject: async () => ({ ok: true, data: null }),
      preview: async () => ({ ok: true, data: { available: false, reason: 'n/a' } }),
    }
    const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values)
    const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]
    const view = render(h(PendingCard, { t, api }))
    await waitFor(() => { expect(screen.getByText(message('approvalEmpty'))).toBeDefined() })
    expect(view.container.querySelectorAll('[role="status"]').length).toBeGreaterThan(0)
    cleanup()
  })
})
