// @tier fast
import { describe, expect, it } from 'vitest'
import { createRowOrderStore, moveRow, orderRows, pinRow, resolveWorkspaceId, rowOrderKey, type StorageLike } from '../src/client/sorting.ts'

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

describe('rowOrderKey', () => {
  it('scopes by workspace and queue and falls back to local', () => {
    expect(resolveWorkspaceId(undefined)).toBe('local')
    expect(resolveWorkspaceId('  ')).toBe('local')
    expect(resolveWorkspaceId('ws-A')).toBe('ws-A')
    expect(rowOrderKey('ws-A', 'pending')).not.toBe(rowOrderKey('ws-A', 'fuse'))
    expect(rowOrderKey(undefined, 'pending')).toContain(':local:pending')
  })

  it('reads and writes only display ids', () => {
    const storage = memoryStorage()
    const orders = createRowOrderStore(storage)
    orders.write('ws-A', 'pending', ['r2', 'r1'])
    expect(orders.read('ws-A', 'pending')).toEqual(['r2', 'r1'])
    expect(orders.read('ws-B', 'pending')).toEqual([])
    expect(orders.read('ws-A', 'fuse')).toEqual([])
    storage.values.set(rowOrderKey('ws-A', 'pending'), '{"bad":true}')
    expect(orders.read('ws-A', 'pending')).toEqual([])
  })
})

describe('orderRows', () => {
  const rows = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]
  it('applies known ids first and appends new wire rows in wire order', () => {
    expect(orderRows(rows, ['r3', 'r1']).map(row => row.id)).toEqual(['r3', 'r1', 'r2'])
    expect(orderRows(rows, ['missing']).map(row => row.id)).toEqual(['r1', 'r2', 'r3'])
    expect(orderRows(rows, [])).toBe(rows)
  })
  it('moves and pins without inventing or duplicating rows', () => {
    expect(moveRow(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(moveRow(['a', 'b', 'c'], 'a', undefined)).toEqual(['b', 'c', 'a'])
    expect(moveRow(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
    expect(pinRow(['a', 'b', 'c'], 'c', 'top')).toEqual(['c', 'a', 'b'])
    expect(pinRow(['a', 'b', 'c'], 'a', 'bottom')).toEqual(['b', 'c', 'a'])
  })
})
