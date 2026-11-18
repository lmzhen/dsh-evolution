// @tier pre-tag
// @vitest-environment jsdom
/** The workbench owns view/selection and exposes one openHistory callback to child views. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
const h = createElement as (...args: unknown[]) => never
import { WorkbenchPage } from '../src/panels/history/client/Workbench.ts'
import { createWorkbenchStore, resolveDefaultView } from '../src/panels/history/client/WorkbenchStore.ts'
import type { PanelFace } from '../src/panels/history/client/Panel.ts'
import type { PendingCardFace } from '../src/panels/settings/PendingCard.ts'

afterEach(cleanup)

function face(loadVersions: any = vi.fn(async () => ({ content: [], support: [] }) as never)): PanelFace {
  return {
    t: (key: string) => key,
    format: (key: string) => key,
    loadSkills: async () => [],
    loadVersions,
    loadDiff: async () => ({ v: 0, kind: 'update', added: 0, removed: 0, hunks: [] }) as never,
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
  it('resolves pending over merge over history and skips an unmounted merge view', () => {
    expect(resolveDefaultView({ pending: 2, merge: 1 }, true)).toBe('pending')
    expect(resolveDefaultView({ pending: 0, merge: 1 }, true)).toBe('merge')
    expect(resolveDefaultView({ pending: 0, merge: 1 }, false)).toBe('history')
  })

  it('moves keyboard focus only across tabs that are actually visible', async () => {
    const view = render(h(WorkbenchPage, {
      t: (key: string) => key,
      store: createWorkbenchStore(),
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
    const view = render(h(WorkbenchPage, {
      t: (key: string) => key,
      store: createWorkbenchStore(),
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

  it('lands on pending when a task exists and the user has not chosen a view', async () => {
    const view = render(h(WorkbenchPage, {
      t: (key: string) => key,
      store: createWorkbenchStore(),
      history: face(),
      pending: pendingFace(),
      loadTaskCounts: async () => ({ pending: 1, merge: 0 }),
    }))
    await waitFor(() => { expect(document.getElementById('evo-workbench-tab-pending')?.getAttribute('aria-selected')).toBe('true') })
    expect(document.querySelector('.evo-workbench-title')?.textContent).toBe('workbench.title')
    view.unmount()
  })

  it('does not let a late count override the user selection', async () => {
    let resolveCounts: ((counts: { pending: number; merge: number }) => void) | undefined
    const counts = new Promise<{ pending: number; merge: number }>((resolve) => { resolveCounts = resolve })
    const view = render(h(WorkbenchPage, {
      t: (key: string) => key,
      store: createWorkbenchStore(),
      history: face(),
      pending: pendingFace(),
      loadTaskCounts: async () => await counts,
    }))
    fireEvent.click(document.getElementById('evo-workbench-tab-history')!)
    await act(async () => { resolveCounts?.({ pending: 1, merge: 0 }) })
    await act(async () => { await counts })
    expect(document.getElementById('evo-workbench-tab-history')?.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById('evo-workbench-tab-pending')?.getAttribute('aria-selected')).toBe('false')
    view.unmount()
  })

  it('restores the view after a remount from the registration-owned store', async () => {
    const store = createWorkbenchStore()
    const props = { t: (key: string) => key, store, history: face(), pending: pendingFace() }
    const first = render(h(WorkbenchPage, props))
    fireEvent.click(document.getElementById('evo-workbench-tab-pending')!)
    expect(document.getElementById('evo-workbench-tab-pending')?.getAttribute('aria-selected')).toBe('true')
    first.unmount()
    const second = render(h(WorkbenchPage, props))
    expect(document.getElementById('evo-workbench-tab-pending')?.getAttribute('aria-selected')).toBe('true')
    second.unmount()
  })

  it('opens the data overview, navigates a name into history and returns with fresh error counts', async () => {
    let errorCount = 0
    const loadStats = vi.fn(async () => ({
      rows: [{
        name: 'alpha',
        description: 'alpha desc',
        versions: 2,
        lastChangedAt: '2026-01-01T00:00:00.000Z',
        lastActivityAt: null,
        recentlyUsed: null,
        needsAttention: true,
        health: { verdict: 'warn', bodyChars: 12, bodyTokens: null, supportFiles: 1, stampDensityPerKb: null, churnPatches: null, churnReads: null, hardCapHits: null, findings: 0 },
        usage: { useCount: 0, viewCount: 3, viewCount30d: 0, patchCount: 1, lastUsedAt: null, lastViewedAt: null, lastPatchedAt: null, state: 'active', pinned: false },
        feedback: 0,
        feedback30d: errorCount,
        negativeFeedback30d: errorCount,
        feedbackRate30d: null,
        errorNotes: errorCount === 0 ? [] : [{ at: '2026-01-01T00:00:00.000Z', note: 'new report' }],
      }],
      global: {
        totals: { skills: 1, needsAttention: 1, bodyChars: 12, supportFiles: 1, successes: { offload: 0, condense: 0, extract: 1 } },
        counts: { offload: 0, condense: 0, extract: 1 },
        governance: [],
      },
      generatedAt: '2026-01-01T00:00:00.000Z',
    }))
    const view = render(h(WorkbenchPage, {
      t: (key: string) => key,
      store: createWorkbenchStore(),
      history: face(),
      pending: pendingFace(),
      stats: {
        t: (key: string) => key,
        loadStats,
        view: { query: '', filter: 'all', sort: { key: 'bodyChars', dir: 'desc' }, scrollTop: 0 },
        onView: () => {},
        layout: 'wide',
        openSkill: () => {},
        onOrganize: () => {},
      },
    }))
    fireEvent.click(document.getElementById('evo-workbench-tab-data')!)
    await waitFor(() => { expect(document.getElementById('evo-workbench-tab-data')?.getAttribute('aria-selected')).toBe('true') })
    await waitFor(() => { expect(document.querySelector('.evo-stats-skill-name')?.textContent).toContain('alpha') })
    errorCount = 1
    fireEvent.click(document.querySelector('.evo-stats-skill-name')!)
    await waitFor(() => { expect(document.getElementById('evo-workbench-tab-history')?.getAttribute('aria-selected')).toBe('true') })
    expect(document.querySelector('.evo-workbench-back')).not.toBeNull()
    fireEvent.click(document.querySelector('.evo-workbench-back')!)
    await waitFor(() => { expect(document.getElementById('evo-workbench-tab-data')?.getAttribute('aria-selected')).toBe('true') })
    expect(document.querySelector('.evo-stats-skill-name')?.textContent).toContain('alpha')
    await waitFor(() => {
      const headers = Array.from(document.querySelectorAll('thead th')).map(cell => cell.textContent ?? '')
      const column = headers.findIndex(text => text.includes('negativeFeedback30d'))
      const dataCell = document.querySelectorAll('tbody tr')[0]?.querySelectorAll('td')[column]
      expect(dataCell?.textContent).toBe('1')
    })
    // Opening a skill invalidates the shared snapshot so its report note history is fresh; the
    // data table itself stays mounted (one more read, not a remount).
    expect(loadStats).toHaveBeenCalledTimes(2)
    view.unmount()
  })
})
