// @tier fast
import { describe, expect, it } from 'vitest'
import { createWorkbenchStore } from '../src/panels/history/client/WorkbenchStore.ts'

describe('workbench store navigation state', () => {
  it('keeps data view state in the store and clears it only on an explicit patch', () => {
    const store = createWorkbenchStore()
    store.setDataView({ query: 'dsh', filter: 'attention', sort: { key: 'lastAt', dir: 'asc' }, scrollTop: 120 })
    expect(store.getState().data).toEqual({ query: 'dsh', filter: 'attention', sort: { key: 'lastAt', dir: 'asc' }, scrollTop: 120 })
    store.setDataView({ query: '' })
    expect(store.getState().data).toMatchObject({ query: '', filter: 'attention', scrollTop: 120 })
  })

  it('shows the list when the user switches from data to the history tab', () => {
    const store = createWorkbenchStore()
    store.openHistory('alpha', 'data')
    store.setView('data')
    expect(store.getState().selectedSkill).toBe('alpha')
    store.setView('history')
    expect(store.getState().selectedSkill).toBeUndefined()
    expect(store.getState().origin).toBeUndefined()
  })

  it('increments the selection revision for repeated opens and can return to the list', () => {
    const store = createWorkbenchStore()
    store.openHistory('alpha', 'list')
    const first = store.getState().selectionRevision
    store.openHistory('alpha', 'list')
    expect(store.getState().selectionRevision).toBe(first + 1)
    expect(store.getState().origin).toBe('list')
    store.backToList()
    expect(store.getState().view).toBe('history')
    expect(store.getState().selectedSkill).toBeUndefined()
    expect(store.getState().origin).toBeUndefined()
  })
})
