// @tier fast
/**
 * The browser cannot import the host's comparators at runtime (all @deepseek-ai/* specifiers are
 * external), so it carries a small copy. This fixture pins that copy's ordering to the core model for
 * every sortable key and both directions; a drift here would make the same table order differently
 * on the host and in the browser.
 */
import { describe, expect, it } from 'vitest'
import { sortSkillStats, type SkillStatsRow } from '@deepseek-ai/dsh-evolution-core/skills'
import { compareRows, filterRows, sortRows } from '../src/panels/history/client/table-model.ts'

function row(name: string, body: number | null, verdict: string, lastAt: string | null = '2026-01-01T00:00:00.000Z'): SkillStatsRow {
  return {
    name,
    description: name,
    versions: name.length,
    lastAt,
    health: {
      verdict,
      bodyChars: body,
      bodyTokens: null,
      supportFiles: null,
      stampDensityPerKb: null,
      churnPatches: null,
      churnReads: null,
      hardCapHits: null,
      findings: 0,
    },
    usage: { useCount: null, viewCount: null, viewCount30d: body, patchCount: null, lastUsedAt: null, lastViewedAt: null, lastPatchedAt: null, state: null, pinned: null },
    feedback: null,
    feedback30d: body,
    negativeFeedback30d: body === null ? null : 0,
    feedbackRate30d: body,
  }
}

const rows = [
  row('z-skill', 10, 'healthy'),
  row('a-skill', null, 'warn'),
  row('m-skill', 0, 'needs-restructure', null),
  row('b-skill', 10, 'unknown'),
]

describe('browser stats model parity', () => {
  const keys = ['name', 'verdict', 'bodyChars', 'supportFiles', 'versions', 'useCount', 'viewCount', 'viewCount30d', 'feedback', 'feedback30d', 'negativeFeedback30d', 'feedbackRate30d', 'lastAt'] as const
  for (const key of keys) {
    for (const dir of ['asc', 'desc'] as const) {
      it(`orders ${key} ${dir} exactly like core`, () => {
        expect(sortRows(rows, key, dir).map(r => r.name)).toEqual(sortSkillStats(rows, key, dir).map(r => r.name))
      })
    }
  }

  it('keeps the same attention filter', () => {
    const host = rows.filter(row => row.health?.verdict === 'warn' || row.health?.verdict === 'needs-restructure').map(r => r.name)
    expect(filterRows(rows, 'attention').map(r => r.name)).toEqual(host)
  })

  it('treats two rows with the same value as a name tie-break', () => {
    expect(compareRows(rows[0]!, rows[3]!, 'bodyChars', 'desc')).toBeGreaterThan(0)
  })
})


