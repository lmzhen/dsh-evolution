/**
 * The TOOL face: the skill list, the version list, and the controls that act on a version.
 *
 * This file renders FACTS. What a row says, in which order and in which slot is decided in core
 * (`skill-row-cells.ts`) and travels with the row, because a browser half cannot import core at
 * runtime; the words come from the locale dictionary through the `Copy` seat. The renderer's only
 * judgements are layout: a cell's slot decides its alignment, and the `aside` slot is the one the
 * browser's ellipsis may never eat (W1).
 *
 * The reading face — a version rendered as a document, and the rendered diff — lives in
 * `document.ts`; the two faces share the scale in `tokens.ts` and nothing else (§15.2 L2b).
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { createElement, type ReactNode } from 'react'
import { button, chip, note } from './atoms.ts'
import type { RowCell, SkillRow, VersionRow } from './api.ts'

/** What a chrome builder needs: the dictionary, and nothing else. */
export interface Copy {
  readonly t: (key: string) => string
  readonly format: (key: string, values: Record<string, string | number>) => string
}

/** One kind of expansion a row can show. */
export type OpenKind = 'diff' | 'preview'

/** The local time an ISO timestamp names, as the operator's own clock shows it. */
export function localTime(at: string): string {
  const parsed = Date.parse(at)
  if (Number.isNaN(parsed)) return at
  const date = new Date(parsed)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** The text one cell shows, resolved through the seat. */
function cellText(copy: Copy, cell: RowCell): string {
  if (!('copy' in cell)) return cell.literal
  return cell.values === undefined ? copy.t(cell.copy) : copy.format(cell.copy, cell.values)
}

/**
 * One line of cells. The slot decides placement; the tone only changes the register.
 * @param cells - the cells of this line, in reading order.
 * @param copy - the dictionary seat.
 * @param className - the line's own class.
 * @param hover - hover text the host cannot express (the local clock), by cell key.
 * @returns the line element.
 */
function cellLine(cells: readonly RowCell[], copy: Copy, className: string, hover: Readonly<Record<string, string>> = {}): ReactNode {
  return createElement('div', { className },
    cells.map(cell => createElement('span', {
      key: cell.key,
      className: 'evo-hist-cell evo-hist-slot-' + cell.slot + ' evo-hist-tone-' + cell.tone,
      title: hover[cell.key] ?? cell.note,
    }, cellText(copy, cell))))
}

/** The search field above the list. */
export function searchField(copy: Copy, query: string, onQuery: (value: string) => void): ReactNode {
  return createElement('div', { className: 'evo-hist-search' },
    createElement('input', {
      type: 'search',
      value: query,
      placeholder: copy.t('search'),
      'aria-label': copy.t('search'),
      onChange: (event: { target: { value: string } }) => { onQuery(event.target.value) },
    }))
}

/**
 * One skill in the left column: its name and size, then what it is and when it last changed.
 * @param copy - the dictionary seat.
 * @param row - the skill's facts and cells.
 * @param selected - whether this is the open skill.
 * @param onOpen - what a click does.
 * @returns the row.
 */
export function skillLine(copy: Copy, row: SkillRow, selected: boolean, onOpen: () => void): ReactNode {
  return createElement('button', {
    key: row.name,
    type: 'button',
    className: 'evo-hist-skill',
    'aria-current': selected ? 'true' : undefined,
    onClick: onOpen,
  },
  cellLine(row.cells.title, copy, 'evo-hist-cell-line'),
  cellLine(row.cells.meta, copy, 'evo-hist-cell-line evo-hist-cell-meta'))
}

/** What one version row needs from the panel's state machine. */
export interface VersionRowProps {
  readonly copy: Copy
  readonly row: VersionRow
  /** Whether this row is the one waiting for a confirmation click. */
  readonly confirming: boolean
  /** Which expansion this row currently shows, if any. */
  readonly open: OpenKind | undefined
  /** The expanded content, already built by the caller. */
  readonly expanded: ReactNode
  readonly onRestore: () => void
  readonly onCancel: () => void
  readonly onToggle: (kind: OpenKind) => void
}

/**
 * One version row: what happened, when, how big — then the controls, then whatever is expanded.
 *
 * The write is the only control that can change anything, and it is the only one that ever takes the
 * primary tone; a toggle that merely reveals more is borderless and carries a drawn chevron, so the
 * two kinds cannot be mistaken for each other (W7/W14).
 * @param props - the row, the copy, and the panel's callbacks.
 * @returns the row.
 */
export function versionRow(props: VersionRowProps): ReactNode {
  const { copy, row, confirming, open, expanded, onRestore, onCancel, onToggle } = props
  const actions: ReactNode[] = []
  if (row.undoable === false) actions.push(chip({ key: 'current', children: copy.t('current') }))
  if (row.undoable === true) {
    // The confirmation is a second click on the same control, so it needs an exit of its own: without
    // one the only way back was another row's button, which silently moved the pending write.
    if (confirming) actions.push(button({ key: 'cancel', onClick: onCancel, children: copy.t('undo.no') }))
    actions.push(button({
      key: 'undo',
      tone: confirming ? 'primary' : 'quiet',
      onClick: onRestore,
      children: confirming ? copy.t('undo.confirm') : copy.t('undo'),
    }))
  }
  if (row.undoable === true || row.charsDelta !== undefined) {
    actions.push(button({
      key: 'diff',
      kind: 'toggle',
      expanded: open === 'diff',
      onClick: () => { onToggle('diff') },
      children: open === 'diff' ? copy.t('diff.hide') : copy.t('diff.show'),
    }))
  }
  // Every version can be READ as a document, support files included: that is what the body route is for.
  actions.push(button({
    key: 'preview',
    kind: 'toggle',
    expanded: open === 'preview',
    onClick: () => { onToggle('preview') },
    children: open === 'preview' ? copy.t('preview.hide') : copy.t('preview.show'),
  }))
  return createElement('div', { key: String(row.v), className: 'evo-hist-row' },
    createElement('div', { className: 'evo-hist-row-body' },
      cellLine(row.cells.title, copy, 'evo-hist-row-title', { time: localTime(row.at) }),
      row.cells.meta.length === 0 ? null : cellLine(row.cells.meta, copy, 'evo-hist-row-summary'),
      expanded),
    createElement('div', { className: 'evo-hist-actions' }, actions))
}

/**
 * One group's heading, and the note that explains the group.
 * @param title - the group's name, already resolved.
 * @param noteText - the group's note, when it has one.
 * @returns the heading and the note, for the caller to place in its own section.
 */
export function groupHeading(title: string, noteText: string | undefined): ReactNode[] {
  return [
    createElement('h3', { key: 'title', className: 'evo-hist-group' }, title),
    noteText === undefined ? null : createElement('p', { key: 'note', className: 'evo-hist-hint' }, noteText),
  ]
}

/** What the list shows when it has nothing to show. */
export function emptyState(text: string): ReactNode {
  return createElement('p', { className: 'evo-hist-empty' }, text)
}

/** One notice about what just happened. */
export function notice(text: string | undefined, error: boolean): ReactNode {
  if (text === undefined) return null
  return note({ error, children: text })
}

/** The pane's heading and its one control. */
export function panelHead(copy: Copy, onRefresh: () => void): ReactNode {
  return createElement('div', { className: 'evo-hist-head' },
    createElement('h2', { className: 'evo-hist-title' }, copy.t('title')),
    button({ key: 'refresh', title: copy.t('refresh'), onClick: onRefresh, children: copy.t('refresh') }))
}

