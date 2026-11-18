// @tier fast
/**
 * The sortable table primitive's contract: semantic table nodes, a real button per sortable header,
 * `aria-sort` on the current column, and a caller-owned sort callback. DOM-less assertions are enough
 * here; the browser lane renders the same element.
 */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { DataTable, type DataTableColumn } from '../src/data-table.ts'

interface Row { readonly name: string; readonly body: number }

const columns: readonly DataTableColumn<Row>[] = [
  { key: 'name', label: 'Name', sortable: true, render: row => row.name },
  { key: 'body', label: 'Body', align: 'right', sortable: true, render: row => String(row.body) },
  { key: 'fixed', label: 'Fixed', render: () => '—' },
]

type Props = Record<string, unknown>
const element = (node: ReactNode): ReactElement<Props> => node as ReactElement<Props>
function walk(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement(node)) return []
  const self = element(node)
  const children = Children.toArray((self.props as { children?: ReactNode }).children)
  return [self, ...children.flatMap(walk)]
}

it('marks the active column and asks the caller to sort from a real button', () => {
  const onSort = vi.fn()
  const table = DataTable<Row>({
    rows: [{ name: 'alpha', body: 2 }, { name: 'beta', body: 1 }],
    columns,
    rowKey: row => row.name,
    sort: { key: 'body', dir: 'desc' },
    onSort,
    caption: 'Skills',
    empty: 'Nothing',
  })
  const headers = walk(table).filter(node => node.type === 'th')
  expect(headers).toHaveLength(3)
  expect(headers[1]?.props['aria-sort']).toBe('descending')
  expect(headers[0]?.props['aria-sort']).toBe('none')
  expect(headers[2]?.props['aria-sort']).toBeUndefined()
  const button = walk(headers[0]).find(node => node.type === 'button')
  expect(button).toBeDefined()
  button?.props.onClick()
  expect(onSort).toHaveBeenCalledWith('name')
})

it('renders a semantic row per record and a colspan empty state', () => {
  const table = DataTable<Row>({
    rows: [],
    columns,
    rowKey: row => row.name,
    caption: 'Skills',
    empty: 'Nothing here',
  })
  const cells = walk(table).filter(node => node.type === 'td')
  expect(cells).toHaveLength(1)
  expect(cells[0]?.props.colSpan).toBe(3)
  expect(cells[0]?.props.className).toContain('evo-data-empty')
  expect(walk(table).filter(node => node.type === 'table')).toHaveLength(1)
  expect(walk(table).filter(node => node.type === 'caption')[0]?.props.className).toContain('evo-data-caption')
})
