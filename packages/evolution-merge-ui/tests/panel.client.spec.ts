// @tier fast
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { MergePanel, type MergeFace } from '../src/client/Panel.ts'

const face: MergeFace = {
  view: {
    counts: { pending: 2, retry: 1, skipped: 3 },
    tabs: [{ queue: 'pending', count: 2 }, { queue: 'retry', count: 1 }, { queue: 'skipped', count: 3 }],
    commands: [],
  },
  rows: [{ id: 'mr_a', pairKey: 'a', a: 'alpha-skill', b: 'beta-skill', state: 'pending', queue: 'pending', stage: null, label: 'alpha-skill + beta-skill', updatedAt: 'x' }],
  t: key => key,
}

it('renders counts, tabs and the pending row read-only', () => {
  const html = renderToStaticMarkup(createElement(MergePanel, face))
  expect(html).toContain('data-role="stat-value">2')
  expect(html).toContain('tab.pending 2')
  expect(html).toContain('alpha-skill + beta-skill')
  expect(html).toContain('data-role="refresh"')
  expect(html).not.toContain('<button data-role="approve"')
})
