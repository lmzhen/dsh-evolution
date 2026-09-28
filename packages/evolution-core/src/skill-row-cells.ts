/**
 * The cells one row shows, decided here and rendered by the client.
 *
 * Why it exists: until 0.14.1 a row's information architecture lived inside one JSX expression
 * (description + ' · ' + state + ' · ' + age), so which facts survived the browser's single-line
 * ellipsis was an accident of concatenation order — on a real library the skill row's age and
 * curation state were clipped away on EVERY row (measured 2026-09-28: 6 skills, descriptions
 * 49–61 characters, ~240px of line). A row now arrives as an ORDERED list of cells, each declaring
 * its slot, and the renderer lays them out: `aside` cells are right-aligned and never truncate, so a
 * decision fact cannot be eaten by a long description again.
 *
 * Invariants: no words live here. A cell carries either a locale key (`copy`, with the values its
 * template needs) or a verbatim fact (`literal` — numbers, hashes, recorded paths). Facts come from
 * the host; the dictionary owns every sentence and every number format, including the ones the panel
 * used to build itself (`row.delta.up`, `time.<unit>.one`, `versions.count`).
 * @module @deepseek-ai/dsh-evolution-core/skill-row-cells
 */

/** Where a cell sits in its row. `aside` is right-aligned and never truncated. */
export type CellSlot = 'lead' | 'meta' | 'aside'

/** The visual register a cell speaks in; the client maps it to a design token. */
export type CellTone = 'primary' | 'secondary' | 'tertiary'

/** What every cell carries, whichever kind it is. */
export interface RowCellBase {
  /** Stable identity, for the renderer's key and for a spec to name one cell. */
  readonly key: string
  /** Where it sits. */
  readonly slot: CellSlot
  /** Which register it speaks in. */
  readonly tone: CellTone
  /** Hover text (a locale key) when the row would otherwise hide the full value. */
  readonly note?: string
}

/** A sentence: the locale key plus the values its template interpolates. */
export interface CopyCell extends RowCellBase {
  readonly copy: string
  readonly values?: Readonly<Record<string, string | number>>
}

/** A fact shown verbatim (a version number, a path, a summary the model wrote). */
export interface LiteralCell extends RowCellBase {
  readonly literal: string
}

/** One cell. Narrow with `'copy' in cell`. */
export type RowCell = CopyCell | LiteralCell

/** The lines one row can show: a title line, and a meta line under it. */
export interface RowCells {
  readonly title: readonly RowCell[]
  readonly meta: readonly RowCell[]
}

/** The facts a version row needs. The client's `VersionRow` satisfies this structurally. */
export interface VersionRowFacts {
  readonly v: number
  readonly actionKind: string
  readonly age: { readonly unit: string; readonly n: number }
  readonly charsDelta?: number
  readonly path?: string
  readonly summary?: string
}

/** The facts a skill row needs. The client's `SkillRow` satisfies this structurally. */
export interface SkillRowFacts {
  readonly name: string
  readonly versions: number
  readonly description: string
  readonly managed: boolean
  readonly protectedBy: string | null
  readonly protectionUnknown: boolean
  readonly age: { readonly unit: string; readonly n: number } | null
}

/** The actions whose row carries an explanatory hover text. */
const ACTION_NOTES: Readonly<Record<string, string>> = {
  delete: 'action.delete.note',
  archive: 'action.archive.note',
}

/** The actions whose bytes come from a support file rather than from SKILL.md. */
const SUPPORT_ACTIONS: readonly string[] = ['support-write', 'support-remove']

/**
 * The relative-time key for one bucket: a count of one is spelled on its own.
 * @param age - the bucket the host reported.
 * @returns the locale key, singular or plural.
 */
export function ageCopyKey(age: { readonly unit: string; readonly n: number }): string {
  // 'now' is its own sentence: there is no count to spell, and no `time.now.one`.
  if (age.unit === 'now') return 'time.now'
  return age.n === 1 ? 'time.' + age.unit + '.one' : 'time.' + age.unit
}

/**
 * The state word one skill row carries, from the facts the listing reported.
 * @param skill - the row's facts.
 * @returns the locale key for its state.
 */
export function skillStateKey(skill: SkillRowFacts): string {
  if (skill.protectionUnknown) return 'state.unknown'
  if (skill.protectedBy !== null) return 'state.protected'
  return skill.managed ? 'state.managed' : 'state.foreign'
}

/** The hover text one action word needs, or nothing when it needs none. */
function actionNote(actionKind: string): { note?: string } {
  const note = ACTION_NOTES[actionKind]
  return note === undefined ? {} : { note }
}

/**
 * The cells of one version row: the facts on the title line, the summary (if any) under it.
 * @param row - the row's facts.
 * @returns both lines.
 */
export function versionRowCells(row: VersionRowFacts): RowCells {
  const title: RowCell[] = [
    { key: 'v', copy: 'row.version', values: { n: row.v }, tone: 'tertiary', slot: 'meta' },
    { key: 'action', copy: 'action.' + row.actionKind, tone: 'primary', slot: 'lead', ...actionNote(row.actionKind) },
    { key: 'time', copy: ageCopyKey(row.age), values: { n: row.age.n }, tone: 'tertiary', slot: 'meta' },
  ]
  if (row.path !== undefined) {
    title.push({ key: 'path', literal: row.path, tone: 'tertiary', slot: 'meta', note: row.path })
  } else if (SUPPORT_ACTIONS.includes(row.actionKind)) {
    title.push({ key: 'path', copy: 'path.unrecorded', tone: 'tertiary', slot: 'meta' })
  }
  const delta = row.charsDelta
  if (delta !== undefined && delta !== 0) {
    title.push({
      key: 'delta',
      copy: delta > 0 ? 'row.delta.up' : 'row.delta.down',
      values: { n: Math.abs(delta) },
      tone: 'tertiary',
      slot: 'meta',
    })
  }
  const meta: RowCell[] = []
  // The summary is the one line a deployment may or may not generate; the host sends it already
  // verbatim, so it needs no dictionary key.
  if (row.summary !== undefined && row.summary !== '') {
    meta.push({ key: 'summary', literal: row.summary, tone: 'secondary', slot: 'lead' })
  }
  return { title, meta }
}


/**
 * The cells of one skill row: the name line, then the facts that describe it.
 *
 * The description is a `lead` cell (it is the one allowed to truncate, with the full text on hover),
 * while the version count and the last-changed time are `aside` cells — they survive any description.
 * The description is NOT pre-truncated in JavaScript: the browser's ellipsis already clips it at the
 * layout's real width, and a character cut on top of that only hides where the fact ends.
 * @param skill - the row's facts.
 * @returns both lines.
 */
export function skillRowCells(skill: SkillRowFacts): RowCells {
  const title: RowCell[] = [
    { key: 'name', literal: skill.name, tone: 'primary', slot: 'lead', note: skill.name },
    { key: 'count', copy: 'versions.count', values: { n: skill.versions }, tone: 'tertiary', slot: 'aside' },
  ]
  const meta: RowCell[] = [
    { key: 'description', literal: skill.description, tone: 'tertiary', slot: 'lead', note: skill.description },
    { key: 'state', copy: skillStateKey(skill), tone: 'tertiary', slot: 'meta' },
  ]
  if (skill.age !== null) {
    meta.push({ key: 'age', copy: ageCopyKey(skill.age), values: { n: skill.age.n }, tone: 'tertiary', slot: 'aside' })
  }
  return { title, meta }
}
