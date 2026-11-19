// @tier pre-tag
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { StatsPage, type StatsFace } from '../src/panels/history/client/StatsPage.ts'
import type { SkillStatsRow, SkillStatsSnapshot } from '@deepseek-ai/dsh-evolution-core/skills'

afterEach(cleanup)

function row(name: string): SkillStatsRow {
  return {
    name,
    description: name + ' description',
    versions: 1,
    lastChangedAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: null,
    recentlyUsed: null,
    needsAttention: false,
    health: { verdict: 'healthy', bodyChars: 10, bodyTokens: null, supportFiles: 1, stampDensityPerKb: null, churnPatches: null, churnReads: null, hardCapHits: null, findings: 0 },
    usage: { useCount: 0, viewCount: 1, viewCount30d: 1, patchCount: 1, lastUsedAt: null, lastViewedAt: null, lastPatchedAt: null, state: 'active', pinned: false },
    feedback: 0,
    feedback30d: 0,
    negativeFeedback30d: 0,
    feedbackRate30d: 0,
    errorNotes: [],
  }
}

function snapshot(): SkillStatsSnapshot {
  const rows = [row('alpha'), row('beta')]
  const totals = { skills: 2, needsAttention: 0, bodyChars: 20, bodyTokens: 30, supportFiles: 2, successes: { offload: 0, condense: 0, extract: 0 } }
  return {
    rows,
    global: { totals, counts: { offload: 0, condense: 0, extract: 0 }, governance: [] },
    generatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function face(layout: 'wide' | 'medium' | 'narrow'): StatsFace {
  return {
    t: (key: string) => key,
    loadStats: async () => snapshot(),
    view: { query: '', filter: 'all', sort: { key: 'bodyChars', dir: 'desc' }, scrollTop: 0 },
    onView: vi.fn(),
    layout,
    openSkill: vi.fn(),
    onOrganize: vi.fn(),
  }
}

describe('stats page presentation', () => {
  it('uses cards at the narrow breakpoint', async () => {
    const view = render(createElement(StatsPage, face('narrow')))
    await waitFor(() => { expect(view.container.querySelectorAll('.evo-stats-card')).toHaveLength(2) })
    expect(view.container.querySelector('.evo-data-table')).toBeNull()
  })

  it('renders unreadable as its own actionable status, not Unknown', async () => {
    const unreadable = {
      ...snapshot(),
      rows: [{
        ...row('unreadable'),
        needsAttention: true,
        health: { ...row('unreadable').health!, verdict: 'unreadable' },
      }],
      global: { ...snapshot().global, totals: { ...snapshot().global.totals, skills: 1, needsAttention: 1 } },
    }
    const view = render(createElement(StatsPage, { ...face('wide'), loadStats: async () => unreadable }))
    await waitFor(() => { expect(view.container.textContent).toContain('stats.verdict.unreadable') })
    expect(view.container.textContent).not.toContain('stats.verdict.unknown')
    expect(view.container.querySelector('.evo-stats-pill')?.className).toContain('is-warn')
  })


  it('renders recent review kind, status and partial reason', async () => {
    const withReviews = {
      ...snapshot(),
      global: {
        ...snapshot().global,
        reviews: [{ reviewId: 'r1', kind: 'skill', status: 'partial', startedAt: 1, finishedAt: 2, partialReason: 'max tool calls reached before review_done', report: { summary: 'half', memoryChanged: false, skillsChanged: [], unresolved: ['left skill'] } }],
      },
    }
    const view = render(createElement(StatsPage, { ...face('wide'), loadStats: async () => withReviews }))
    await waitFor(() => { expect(view.container.textContent).toContain('stats.reviews.title') })
    expect(view.container.textContent).toContain('stats.review.kind.skill')
    expect(view.container.textContent).toContain('stats.review.status.partial')
    expect(view.container.textContent).toContain('max tool calls reached before review_done')
    expect(view.container.textContent).toContain('left skill')
  })

  it('distinguishes an empty library from a filter with no matches', async () => {
    const filtered = render(createElement(StatsPage, { ...face('wide'), view: { ...face('wide').view, query: 'zzz' } }))
    await waitFor(() => { expect(filtered.container.textContent).toContain('stats.emptyFilter') })
    expect(filtered.container.textContent).toContain('stats.filterHint')
    cleanup()
    const empty = render(createElement(StatsPage, { ...face('wide'), loadStats: async () => ({ ...snapshot(), rows: [], global: { ...snapshot().global, totals: { ...snapshot().global.totals, skills: 0, needsAttention: 0 } } }) }))
    await waitFor(() => { expect(empty.container.textContent).toContain('stats.emptyHint') })
    expect(empty.container.textContent).not.toContain('stats.filterHint')
  })

  it('keeps the table at wide and medium breaks and hides low-priority columns at medium', async () => {
    const wide = render(createElement(StatsPage, face('wide')))
    await waitFor(() => { expect(wide.container.querySelectorAll('thead th')).toHaveLength(11) })
    expect(wide.container.textContent).toContain('stats.col.bodyTokens')
    expect(wide.container.textContent).toContain('stats.total.bodyTokens')
    wide.unmount()
    const medium = render(createElement(StatsPage, face('medium')))
    await waitFor(() => { expect(medium.container.querySelectorAll('thead th')).toHaveLength(6) })
  })
})
