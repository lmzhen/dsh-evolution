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

/** Rows inside the first loader-patch entry (`[].insert`), or empty. */
export function insertedRows(value: unknown): CordisRow[] {
  const rows = cordisRows(value)
  const first = rows[0]
  if (!first) return []
  return cordisRows(first.insert)
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
