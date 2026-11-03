// @tier pre-tag
// @vitest-environment jsdom
/** The workbench consumes explicit navigation exactly once and keeps the page mounted. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
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
  it('consumes one explicit revision and does not replay it on a plain rerender', async () => {
    const loadVersions = vi.fn(async () => ({ content: [], support: [] }))
    const history = face(loadVersions)
    const view = render(createElement(WorkbenchPage, {
      pageId: 'evolution.workbench',
      params: { view: 'history', skillName: 'alpha' },
      revision: 1,
      t: (key: string) => key,
      history,
      pending: pendingFace(),
    }))
    await waitFor(() => { expect(loadVersions).toHaveBeenCalledWith('alpha') })
    view.rerender(createElement(WorkbenchPage, {
      pageId: 'evolution.workbench',
      params: { view: 'history', skillName: 'alpha' },
      revision: 1,
      t: (key: string) => key,
      history,
      pending: pendingFace(),
    }))
    expect(loadVersions).toHaveBeenCalledTimes(1)
    view.rerender(createElement(WorkbenchPage, {
      pageId: 'evolution.workbench',
      params: { view: 'history', skillName: 'beta' },
      revision: 2,
      t: (key: string) => key,
      history,
      pending: pendingFace(),
    }))
    await waitFor(() => { expect(loadVersions).toHaveBeenCalledWith('beta') })
  })
})
