/**
 * The one hunk→line projection shared by the two diff readers. A hunk carries the removed and the
 * added text; both panels render them as `-`/`+` rows with a key scoped to the hunk (a per-hunk
 * index restarts at 0, so an unscoped key let React reconcile one hunk's line into another's).
 * @module @deepseek-ai/dsh-evolution-ui/panels/hunk-lines
 */

/** The two text sides a diff hunk carries. */
export interface HunkText {
  readonly oldText: string
  readonly newText: string
}

/** One rendered diff line, before the consumer adds its own class name. */
export interface HunkRow {
  readonly side: 'del' | 'add'
  readonly key: string
  readonly text: string
}

/**
 * Project one hunk into its render rows: removed lines first, then added. An empty side produces
 * no rows; the single empty string an empty side splits into is not a line.
 * @param hunk - the hunk's old/new text.
 * @param hunkIndex - the hunk's position, used to scope React keys.
 * @returns the ordered rows.
 */
export function hunkRows(hunk: HunkText, hunkIndex: number): HunkRow[] {
  const rows: HunkRow[] = []
  for (const [index, line] of hunk.oldText.split('\n').entries()) {
    if (hunk.oldText === '' && line === '') continue
    rows.push({ side: 'del', key: 'old-' + String(hunkIndex) + '-' + String(index), text: line })
  }
  for (const [index, line] of hunk.newText.split('\n').entries()) {
    if (hunk.newText === '' && line === '') continue
    rows.push({ side: 'add', key: 'new-' + String(hunkIndex) + '-' + String(index), text: line })
  }
  return rows
}
