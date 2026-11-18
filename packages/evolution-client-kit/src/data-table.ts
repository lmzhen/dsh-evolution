/**
 * One accessible, sortable table primitive for the family's read-only data pages.
 *
 * WHY IT LIVES HERE: the history panel, the stats page and later the queue views all need the same
 * table semantics. A div grid would lose `<th>`, `aria-sort`, keyboard focus and screen-reader
 * navigation; copying a second table implementation would let those rules drift.
 *
 * The component is controlled: the caller owns sort state and row actions. It renders no data logic.
 * @module @lmzhen/dsh-evolution-client-kit
 */
import { createElement, type ReactNode } from 'react'

export type DataTableAlign = 'left' | 'right'

export interface DataTableSort {
  readonly key: string
  readonly dir: 'asc' | 'desc'
}

export interface DataTableColumn<Row> {
  readonly key: string
  readonly label: string
  readonly align?: DataTableAlign
  readonly sortable?: boolean
  /** The value sorted on; required for a sortable column. */
  readonly sortValue?: (row: Row) => string | number | null
  readonly render: (row: Row) => ReactNode
}

export interface DataTableProps<Row> {
  readonly rows: readonly Row[]
  readonly columns: readonly DataTableColumn<Row>[]
  readonly rowKey: (row: Row) => string
  readonly sort?: DataTableSort | null
  readonly onSort?: (key: string) => void
  readonly empty?: ReactNode
  readonly caption: string
  readonly className?: string
}

const SORT_MARK = { none: '↕', asc: '↑', desc: '↓' } as const

/**
 * Render a semantic sortable table.
 * @param props - rows, column definitions, controlled sort and empty state.
 * @returns the table region.
 */
export function DataTable<Row>(props: DataTableProps<Row>): ReactNode {
  const ariaSort = (column: DataTableColumn<Row>): 'ascending' | 'descending' | 'none' => {
    if (props.sort?.key !== column.key) return 'none'
    return props.sort.dir === 'asc' ? 'ascending' : 'descending'
  }
  const headCells = props.columns.map(column => {
    const content = column.sortable === true
      ? createElement('button', {
        type: 'button',
        className: 'evo-data-sort',
        onClick: () => { props.onSort?.(column.key) },
      }, column.label, createElement('span', { className: 'evo-data-mark', 'aria-hidden': 'true' }, props.sort?.key === column.key ? SORT_MARK[props.sort.dir] : SORT_MARK.none))
      : column.label
    return createElement('th', {
      key: column.key,
      scope: 'col',
      className: 'evo-data-th' + (column.align === 'right' ? ' evo-data-num' : '') + (props.sort?.key === column.key ? ' evo-data-th-active' : ''),
      'aria-sort': column.sortable === true ? ariaSort(column) : undefined,
    }, content)
  })
  const head = createElement('thead', null, createElement('tr', null, headCells))
  const bodyRows = props.rows.map(row => {
    const cells = props.columns.map(column => createElement('td', {
      key: column.key,
      className: 'evo-data-td' + (column.align === 'right' ? ' evo-data-num' : ''),
    }, column.render(row)))
    return createElement('tr', { key: props.rowKey(row), className: 'evo-data-tr' }, cells)
  })
  const body = createElement('tbody', null,
    props.rows.length === 0
      ? createElement('tr', { className: 'evo-data-empty-row' },
        createElement('td', { colSpan: props.columns.length, className: 'evo-data-empty' }, props.empty))
      : bodyRows,
  )
  return createElement('div', {
    className: 'evo-data-scroll' + (props.className === undefined ? '' : ' ' + props.className),
    tabIndex: 0,
    role: 'region',
    'aria-label': props.caption,
  }, createElement('table', { className: 'evo-data-table' },
    createElement('caption', { className: 'evo-data-caption' }, props.caption),
    head,
    body,
  ))
}

/** Styles for the primitive; the page owns token scope. */
export const DATA_TABLE_CSS = [
  '.evo-data-scroll{overflow:auto;max-width:100%;min-width:0;border-radius:var(--evo-radius-card,12px);outline:none}',
  '.evo-data-scroll:focus-visible{outline:var(--evo-focus-ring,2px solid #2f6b58);outline-offset:var(--evo-focus-offset,2px)}',
  '.evo-data-table{width:100%;border-collapse:separate;border-spacing:0;min-width:880px;font-size:var(--evo-type-sm,13px)}',
  '.evo-data-caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
  '.evo-data-th{position:sticky;top:0;z-index:2;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e2da);background:var(--dsw-alias-bg-layer-2,#faf9f5);color:var(--dsw-alias-label-tertiary,#9aa096);font-size:11px;font-weight:600;text-align:left;white-space:nowrap}',
  '.evo-data-th-active{color:var(--evo-accent,#2f6b58);background:var(--evo-accent-weak,#f2f8f4)}',
  '.evo-data-sort{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;padding:0;cursor:pointer;border-radius:4px}',
  '.evo-data-sort:focus-visible{outline:var(--evo-focus-ring,2px solid #2f6b58);outline-offset:2px}',
  '.evo-data-mark{font-size:10px;opacity:.8}',
  '.evo-data-tr:hover .evo-data-td{background:var(--dsw-alias-interactive-bg-hover,#fbfcf9)}',
  '.evo-data-td{padding:10px;border-bottom:1px solid var(--dsw-alias-border-l1,#f0eee8);vertical-align:middle;min-width:0}',
  '.evo-data-tr:last-child .evo-data-td{border-bottom:0}',
  '.evo-data-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.evo-data-empty{padding:32px 16px;text-align:center;color:var(--dsw-alias-label-tertiary,#9aa096)}',
  '.evo-data-empty-row:hover .evo-data-empty{background:transparent}',
  '@media (max-width:720px){.evo-data-table{min-width:760px}}',
].join('')
