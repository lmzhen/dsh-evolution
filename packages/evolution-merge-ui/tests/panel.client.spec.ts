// @tier fast
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { MergePanel, type MergeFace } from '../src/client/Panel.ts'

const face: MergeFace = {
  view: {
    counts: { verify: 0, pending: 2, fuse: 1, skipped: 3 },
    tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 2 }, { queue: 'fuse', count: 1 }, { queue: 'skipped', count: 3 }],
    commands: [],
    approval: true,
    latestRun: { id: 'run-1', state: 'running', stage: 'author', startedAt: 1 },
  },
  rows: [{ id: 'mr_a', pairKey: 'a', a: 'alpha-skill', b: 'beta-skill', state: 'pending', queue: 'pending', stage: null, label: 'alpha-skill + beta-skill', updatedAt: 'x', actions: ['/evolution merge approve mr_a', '/evolution merge reject mr_a'] }],
  t: key => key,
}

it('renders counts, tabs and the pending row read-only', () => {
  const html = renderToStaticMarkup(createElement(MergePanel, face))
  expect(html).toContain('data-role="stat-value">2')
  expect(html).toContain('tab.pending 2')
  expect(html).toContain('alpha-skill + beta-skill')
  expect(html).toContain('data-role="refresh"')
  expect(html).not.toContain('<button data-role="approve"')
  expect(html).toContain('data-role="run-strip"')
  expect(html).toContain('approval.on')
  expect(html).toContain('data-role="row-action"')
  expect(html).toContain('state.pending')
})
it('shows loading on the first render when a loader exists', () => {
  const html = renderToStaticMarkup(createElement(MergePanel, { ...face, loadRows: async () => ({ ok: true, payload: { queue: 'pending' as const, items: [] } }) }))
  expect(html).toContain('data-state="loading"')
})
