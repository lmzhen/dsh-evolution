// @tier pre-tag
// @vitest-environment jsdom
/** The workbench owns view/selection and exposes one openHistory callback to child views. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { WorkbenchPage } from '../src/panels/history/client/Workbench.ts'
import type { PanelFace } from '../src/panels/history/client/Panel.ts'
import type { PendingCardFace } from '../src/panels/settings/PendingCard.ts'

afterEach(cleanup)

function face(loadVersions = vi.fn(async () => ({ content: [], support: [] }))): PanelFace {
  return {
    t: (key: string) => key,
    format: (key: string) => key,
    loadSkills: async () => [],
    loadVersions,
    loadDiff: async () => ({ v: 0, kind: 'update', added: 0, removed: 0, hunks: [] }),
    loadBody: async () => ({ v: 0, chars: 0, display: '', truncated: false }),
    undo: async () => 'ok',
    markdownWords: { copy: 'copy', copied: 'copied', footnotes: 'footnotes' },
  }
}

const pendingFace = (): PendingCardFace => ({
  t: (key: string) => key,
  api: {
    pending: async () => ({ ok: true, data: [] }),
    approve: async () => ({ ok: true, data: null }),
    reject: async () => ({ ok: true, data: null }),
    release: async () => ({ ok: true, data: null }),
    preview: async () => ({ ok: true, data: { available: false, reason: 'n/a' } }),
  },
  confirmMode: () => 'auto',
})

describe('history workbench', () => {
  it('moves keyboard focus only across tabs that are actually visible', async () => {
    const view = render(createElement(WorkbenchPage, {
      t: (key: string) => key,
      history: face(),
      pending: pendingFace(),
      hasView: (name: string) => name !== 'merge' && name !== 'health',
    }))
    const historyTab = document.getElementById('evo-workbench-tab-history')!
    fireEvent.keyDown(historyTab, { key: 'ArrowRight' })
    await waitFor(() => { expect(document.activeElement?.id).toBe('evo-workbench-tab-pending') })
    expect(document.getElementById('evo-workbench-tab-pending')?.getAttribute('aria-selected')).toBe('true')
    view.unmount()
  })

  it('opens history through the owner callback, including a repeated same-skill navigation', async () => {
    const loadVersions = vi.fn(async () => ({ content: [], support: [] }))
    let owner: { openHistory?: (name: string) => void } = {}
    const view = render(createElement(WorkbenchPage, {
      t: (key: string) => key,
      history: face(loadVersions),
      pending: pendingFace(),
      renderSlot: (_name: string, next: Record<string, unknown>) => { owner = next as typeof owner; return null },
    }))
    await act(async () => { owner.openHistory?.('alpha') })
    await waitFor(() => { expect(loadVersions).toHaveBeenCalledWith('alpha') })
    const firstCalls = loadVersions.mock.calls.length
    await act(async () => { owner.openHistory?.('alpha') })
    await waitFor(() => { expect(loadVersions.mock.calls.length).toBeGreaterThan(firstCalls) })
    await act(async () => { owner.openHistory?.('beta') })
    await waitFor(() => { expect(loadVersions).toHaveBeenCalledWith('beta') })
    view.unmount()
  })
})
