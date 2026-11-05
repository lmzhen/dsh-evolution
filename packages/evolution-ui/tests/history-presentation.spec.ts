// @tier fast
import { expect, it } from 'vitest'
import { versionRowCells } from '@deepseek-ai/dsh-evolution-core'
import { historyViewModel } from '../src/panels/history/client/history-presentation.ts'
import type { VersionRow } from '../src/panels/history/client/api.ts'

const row = (v: number, undoable: boolean): VersionRow => {
  const facts = { v, actionKind: 'update', age: { unit: 'hours', n: v } }
  return {
    ...facts, at: '2026-11-05T00:00:00Z', action: 'update', hash: 'h' + String(v), chars: 10, undoable,
    cells: versionRowCells(facts),
  }
}

it('separates current from older body rows and keeps support separate', () => {
  const model = historyViewModel({ content: [row(3, false), row(2, true), row(1, true)], support: [row(9, true)] })
  expect(model.current.map(item => item.v)).toEqual([3])
  expect(model.older.map(item => item.v)).toEqual([2, 1])
  expect(model.support.map(item => item.v)).toEqual([9])
  expect(model.hasAny).toBe(true)
})

it('falls back to the first content row when an older payload has no current marker', () => {
  const model = historyViewModel({ content: [row(2, true), row(1, true)], support: [] })
  expect(model.current.map(item => item.v)).toEqual([2])
  expect(model.older.map(item => item.v)).toEqual([1])
})
