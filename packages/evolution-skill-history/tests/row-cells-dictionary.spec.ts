/**
 * The seam between the cells the host package builds and the words THIS package owns (G1).
 *
 * A row is assembled in `evolution-core` (which may not know a single word) and spoken here (which may
 * not re-derive a single fact). Nothing in the type system connects the two: a cell whose `copy` key is
 * missing from the dictionary renders as that key, which is exactly the kind of seam only a rendered
 * panel reveals. These cases close it statically — every key the builders can emit resolves in BOTH
 * dictionaries, and every `{slot}` a template interpolates gets a value from the cell that named it.
 */
import { describe, expect, it } from 'vitest'
import { ageCopyKey, skillRowCells, versionActionKind, versionRowCells, versionRowNote } from '@deepseek-ai/dsh-evolution-core'
import type { CopyCell, RowCell, SkillRowFacts, VersionRowFacts } from '@deepseek-ai/dsh-evolution-core'
import { en, fill, zh } from '../src/client/messages.ts'

/** Every action label the library can record, plus one it never wrote (the fail-closed case). */
const RAW_ACTIONS = [
  'baseline', 'create', 'patch', 'edit', 'update', 'restore', 'delete', 'archive',
  'consolidate', 'restructure', 'write_file', 'remove_file', 'a-new-write-kind',
]

/** Every relative-time bucket the host can report. */
const UNITS = ['now', 'minutes', 'hours', 'days', 'months', 'years']

const version = (over: Partial<VersionRowFacts> = {}): VersionRowFacts => ({
  v: 7, actionKind: 'update', age: { unit: 'hours', n: 5 }, ...over,
})

const skill = (over: Partial<SkillRowFacts> = {}): SkillRowFacts => ({
  name: 'alpha', versions: 3, description: 'first skill', managed: true,
  protectedBy: null, protectionUnknown: false, age: { unit: 'days', n: 2 }, ...over,
})

/** The copy cells of the cells handed in, in reading order. */
const copies = (...cells: readonly (RowCell | undefined)[]): CopyCell[] =>
  cells.filter((cell): cell is CopyCell => cell !== undefined && 'copy' in cell)

/** A dictionary's copy for a key, or undefined when the key is missing. */
const wordOf = (dictionary: Record<string, string>, key: string): string | undefined => dictionary[key]

/** The one cell of a line with this key. */
const cellOf = (cells: readonly RowCell[], key: string): RowCell | undefined => cells.find(cell => cell.key === key)

describe('the cells a row carries resolve in the panel dictionary (G1)', () => {
  it('names every action the host can report, in both languages', () => {
    for (const raw of RAW_ACTIONS) {
      const action = copies(...versionRowCells(version({ actionKind: versionActionKind(raw) })).title)
        .find(cell => cell.key === 'action')
      expect(action, raw).toBeDefined()
      expect(wordOf(zh, action?.copy ?? ''), raw).toBeTypeOf('string')
      expect(wordOf(en, action?.copy ?? ''), raw).toBeTypeOf('string')
    }
  })

  it('spells the size delta in both directions, from the cell that carries the number', () => {
    for (const delta of [12, -12]) {
      const cell = copies(...versionRowCells(version({ charsDelta: delta })).title)
        .find(one => one.key === 'delta')
      expect(cell, String(delta)).toBeDefined()
      for (const dictionary of [zh, en]) {
        const filled = fill(wordOf(dictionary, cell?.copy ?? '') ?? '', cell?.values ?? {})
        expect(filled, String(delta)).not.toContain('{')
      }
    }
  })

  it('explains a delete and an archive version with copy that exists', () => {
    for (const kind of ['delete', 'archive']) {
      const cell = cellOf(versionRowCells(version({ actionKind: kind })).title, 'action')
      const note = cell !== undefined && 'note' in cell ? cell.note : undefined
      expect(note, kind).toBeTypeOf('string')
      expect(wordOf(zh, note ?? ''), kind).toBeTypeOf('string')
      expect(wordOf(en, note ?? ''), kind).toBeTypeOf('string')
    }
  })

  it('spells every relative-time bucket, singular and plural', () => {
    for (const unit of UNITS) {
      const keys = unit === 'now'
        ? [ageCopyKey({ unit, n: 1 })]
        : [ageCopyKey({ unit, n: 1 }), ageCopyKey({ unit, n: 5 })]
      for (const key of keys) {
        expect(wordOf(zh, key), key).toBeTypeOf('string')
        expect(wordOf(en, key), key).toBeTypeOf('string')
      }
    }
    // 'now' is a sentence, not a count: nothing to interpolate, so nothing to leave behind.
    expect(zh['time.now']).not.toContain('{')
    expect(en['time.now']).not.toContain('{')
  })

  it('names all four curation states', () => {
    const facts = [skill(), skill({ managed: false }), skill({ protectedBy: 'guard' }), skill({ protectionUnknown: true })]
    for (const one of facts) {
      const state = cellOf(skillRowCells(one).meta, 'state')
      const key = state !== undefined && 'copy' in state ? state.copy : ''
      expect(wordOf(zh, key), key).toBeTypeOf('string')
      expect(wordOf(en, key), key).toBeTypeOf('string')
    }
  })

  it('leaves no placeholder unfilled in a whole row', () => {
    const cells = copies(
      ...versionRowCells(version({ actionKind: 'delete', charsDelta: 9 })).title,
      versionRowNote(version({ summary: 'a summary' })),
      ...skillRowCells(skill()).title,
      ...skillRowCells(skill()).meta,
    )
    // The count, the version number, the delta and the age all carry a value, so a template that
    // interpolates one cannot come out with a literal brace left in it.
    expect(cells.map(cell => cell.key)).toContain('count')
    for (const cell of cells) {
      for (const dictionary of [zh, en]) {
        const word = wordOf(dictionary, cell.copy)
        expect(word, cell.copy).toBeTypeOf('string')
        expect(fill(word ?? '', cell.values ?? {}), cell.copy).not.toContain('{')
      }
    }
  })

  it('keeps the two dictionaries in step for every key a row can name', () => {
    const cells = copies(
      ...versionRowCells(version({ actionKind: 'delete', path: 'a.md', charsDelta: -4 })).title,
      ...versionRowCells(version({ actionKind: 'support-write' })).title,
      versionRowNote(version({ summary: 'a summary' })),
      ...skillRowCells(skill()).title,
      ...skillRowCells(skill()).meta,
    )
    for (const cell of cells) {
      expect(Object.hasOwn(zh, cell.copy), cell.copy).toBe(Object.hasOwn(en, cell.copy))
    }
  })
})
