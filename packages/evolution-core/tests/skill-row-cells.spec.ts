/**
 * The cells one row shows (G1, §15 L1).
 *
 * A row stopped being a sentence built by string concatenation. What the browser's one-line ellipsis
 * used to eat was decided by concatenation ORDER: on a real library the skill row's size and age were
 * clipped on every row because the description came first (measured 2026-09-28). These cases pin the
 * two properties that fix it — a row is an ORDERED list of named cells, and the facts a reader decides
 * on are `aside` cells, which the renderer right-aligns and never truncates.
 *
 * They also pin the other half of the seam: no words here. A copy cell carries a locale KEY and the
 * values its template interpolates; the dictionary (client package) owns every sentence and the ORDER
 * of a number and its unit. `row-cells-dictionary.spec.ts` proves the two sides agree.
 */
import { describe, expect, it } from 'vitest'
import { ageCopyKey, skillRowCells, skillStateKey, versionRowCells } from '@deepseek-ai/dsh-evolution-core'
import type { CopyCell, RowCell, SkillRowFacts, VersionRowFacts } from '@deepseek-ai/dsh-evolution-core'

const version = (over: Partial<VersionRowFacts> = {}): VersionRowFacts => ({
  v: 3, actionKind: 'update', age: { unit: 'hours', n: 5 }, ...over,
})

const skill = (over: Partial<SkillRowFacts> = {}): SkillRowFacts => ({
  name: 'alpha', versions: 4, description: 'first skill', managed: true,
  protectedBy: null, protectionUnknown: false, age: { unit: 'days', n: 2 }, ...over,
})

/** The cell keys, in the order the renderer walks them. */
const keys = (cells: readonly RowCell[]): string[] => cells.map(cell => cell.key)

/** The slot one key declares; 'missing' names an absent cell instead of throwing. */
const slotOf = (cells: readonly RowCell[], key: string): string =>
  cells.find(cell => cell.key === key)?.slot ?? 'missing'

/** The cell with this key, whichever kind it is. */
const cellOf = (cells: readonly RowCell[], key: string): RowCell | undefined =>
  cells.find(cell => cell.key === key)

describe('one version row as cells (G1)', () => {
  it('reads version, action, then time', () => {
    const cells = versionRowCells(version())
    expect(keys(cells.title)).toEqual(['v', 'action', 'time'])
    expect(cells.meta).toEqual([])
    expect(slotOf(cells.title, 'action')).toBe('lead')
    expect(slotOf(cells.title, 'v')).toBe('meta')
    expect(slotOf(cells.title, 'time')).toBe('meta')
  })

  it('speaks the action in the primary register and the facts in the tertiary one', () => {
    const cells = versionRowCells(version())
    expect(cellOf(cells.title, 'action')).toMatchObject({ copy: 'action.update', tone: 'primary' })
    expect(cellOf(cells.title, 'v')).toMatchObject({ copy: 'row.version', values: { n: 3 }, tone: 'tertiary' })
    expect(cellOf(cells.title, 'time')).toMatchObject({ copy: 'time.hours', values: { n: 5 }, tone: 'tertiary' })
  })

  it('shows the recorded path, and says so when a support version has none', () => {
    const withPath = versionRowCells(version({ actionKind: 'support-write', path: 'references/a.md' }))
    expect(cellOf(withPath.title, 'path')).toMatchObject({ literal: 'references/a.md', slot: 'meta' })
    const legacy = versionRowCells(version({ actionKind: 'support-remove' }))
    expect(cellOf(legacy.title, 'path')).toMatchObject({ copy: 'path.unrecorded' })
    // A body version without a recorded path has nothing to say about a path at all.
    expect(keys(versionRowCells(version()).title)).not.toContain('path')
  })

  it('carries the size delta only when there is one', () => {
    expect(cellOf(versionRowCells(version({ charsDelta: 12 })).title, 'delta'))
      .toMatchObject({ copy: 'row.delta.up', values: { n: 12 } })
    expect(cellOf(versionRowCells(version({ charsDelta: -12 })).title, 'delta'))
      .toMatchObject({ copy: 'row.delta.down', values: { n: 12 } })
    expect(keys(versionRowCells(version({ charsDelta: 0 })).title)).not.toContain('delta')
    expect(keys(versionRowCells(version()).title)).not.toContain('delta')
  })

  it('explains what a delete or an archive version holds, and nothing else', () => {
    expect(cellOf(versionRowCells(version({ actionKind: 'delete' })).title, 'action'))
      .toMatchObject({ copy: 'action.delete', note: 'action.delete.note' })
    expect(cellOf(versionRowCells(version({ actionKind: 'archive' })).title, 'action'))
      .toMatchObject({ copy: 'action.archive', note: 'action.archive.note' })
    expect(cellOf(versionRowCells(version({ actionKind: 'patch' })).title, 'action')?.note).toBeUndefined()
  })

  it('puts the optional summary on its own line, verbatim', () => {
    const cells = versionRowCells(version({ summary: 'tightened the trigger list' }))
    expect(cells.meta).toEqual([{ key: 'summary', literal: 'tightened the trigger list', tone: 'secondary', slot: 'lead' }])
    // No summary (or an empty one) means no second line at all, not an empty one.
    expect(versionRowCells(version({ summary: '' })).meta).toEqual([])
    expect(versionRowCells(version()).meta).toEqual([])
  })
})

describe('one skill row as cells (G1)', () => {
  it('puts the name and the size on the title line', () => {
    const cells = skillRowCells(skill())
    expect(keys(cells.title)).toEqual(['name', 'count'])
    expect(cellOf(cells.title, 'name')).toMatchObject({ literal: 'alpha', tone: 'primary', slot: 'lead' })
    expect(cellOf(cells.title, 'count')).toMatchObject({ copy: 'versions.count', values: { n: 4 } })
  })

  it('puts the description, the state and the age on the meta line', () => {
    const cells = skillRowCells(skill())
    expect(keys(cells.meta)).toEqual(['description', 'state', 'age'])
    expect(cellOf(cells.meta, 'description')).toMatchObject({ literal: 'first skill', tone: 'tertiary', slot: 'lead' })
    expect(cellOf(cells.meta, 'state')).toMatchObject({ copy: 'state.managed', slot: 'meta' })
    expect(cellOf(cells.meta, 'age')).toMatchObject({ copy: 'time.days', values: { n: 2 }, slot: 'aside' })
  })

  it('never lets a long description decide whether the facts survive (W1)', () => {
    const cells = skillRowCells(skill({ description: 'x'.repeat(200) }))
    // The two facts a reader decides on are ASIDE: right-aligned, outside the truncating line.
    expect(slotOf(cells.title, 'count')).toBe('aside')
    expect(slotOf(cells.meta, 'age')).toBe('aside')
    expect(slotOf(cells.meta, 'state')).toBe('meta')
    // ...and the description reaches the renderer whole, with the full text on hover: the browser
    // ellipsis clips it at the layout's real width, which a character count cannot know.
    expect(cellOf(cells.meta, 'description')).toMatchObject({ literal: 'x'.repeat(200), note: 'x'.repeat(200) })
  })

  it('says nothing about an age it does not have', () => {
    expect(keys(skillRowCells(skill({ age: null })).meta)).toEqual(['description', 'state'])
  })
})

describe('the words a cell may not carry (G1)', () => {
  it('names a bucket, spelling a count of one on its own, and never inventing one for now', () => {
    expect(ageCopyKey({ unit: 'hours', n: 1 })).toBe('time.hours.one')
    expect(ageCopyKey({ unit: 'hours', n: 5 })).toBe('time.hours')
    expect(ageCopyKey({ unit: 'now', n: 1 })).toBe('time.now')
  })

  it('reads the curation state from the facts the listing reported', () => {
    expect(skillStateKey(skill())).toBe('state.managed')
    expect(skillStateKey(skill({ managed: false }))).toBe('state.foreign')
    expect(skillStateKey(skill({ protectedBy: 'guard' }))).toBe('state.protected')
    // An unreadable marker outranks both: claiming 'managed' or 'protected' would be a guess.
    expect(skillStateKey(skill({ protectionUnknown: true, protectedBy: 'guard' }))).toBe('state.unknown')
  })

  it('emits locale keys, never sentences', () => {
    const cells = [...versionRowCells(version({ actionKind: 'delete', path: 'a.md', charsDelta: 3 })).title,
      ...skillRowCells(skill()).title, ...skillRowCells(skill()).meta]
    const copies = cells.filter((cell): cell is CopyCell => 'copy' in cell)
    expect(copies.length).toBeGreaterThan(5)
    for (const cell of copies) {
      expect(cell.copy).toMatch(/^[a-z][a-z0-9.-]*$/)
      expect(cell.copy).not.toContain(' ')
    }
  })
})
