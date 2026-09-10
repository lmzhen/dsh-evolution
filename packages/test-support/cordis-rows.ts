/**
 * Small typed accessors for loader-patch fixtures in evolution tests.
 *
 * `loadOverlayPatches` returns `unknown`; these helpers normalize that shape
 * once so tests do not need per-row `any` casts.
 */

export interface CordisRow {
  id?: unknown
  name?: unknown
  insert?: unknown
  disabled?: unknown
  config?: unknown
  [key: string]: unknown
}

export function cordisRows(value: unknown): CordisRow[] {
  if (!Array.isArray(value)) throw new Error('expected a cordis row list')
  return value.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return {}
    return item as CordisRow
  })
}

/** Rows across EVERY loader-patch entry (all `[].insert` blocks merged, in
 * file order). v21 (T-3): the old form read only the FIRST entry, so rows
 * added under a second/third `- insert:` block were invisible to every spec
 * that pins the row set — a contract "exactly" that could not see additions.
 * Top-level rows without an `insert` block (e.g. bare override rows) simply
 * contribute nothing. */
export function insertedRows(value: unknown): CordisRow[] {
  const rows = cordisRows(value)
  return rows.flatMap(entry => (Array.isArray(entry.insert) ? cordisRows(entry.insert) : []))
}

export function rowId(row: CordisRow | undefined): string {
  return row && typeof row.id === 'string' ? row.id : ''
}

export function rowName(row: CordisRow | undefined): string {
  return row && typeof row.name === 'string' ? row.name : ''
}

export function rowIds(rows: readonly CordisRow[]): string[] {
  return rows.map(rowId).filter(id => id !== '')
}

/** v21 (T-3): row ids for EXACT-set pins. Unlike `rowIds` (which silently
 * drops id-less rows), a row without an `id` surfaces as `'<no-id>'` so an
 * equality assertion FAILS instead of quietly ignoring the addition. */
export function pinnedRowIds(rows: readonly CordisRow[]): string[] {
  return rows.map(row => (row && typeof row.id === 'string' ? row.id : '<no-id>'))
}
