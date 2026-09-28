// @vitest-environment jsdom
/**
 * The panel's state machine, RENDERED: the family of behaviour neither \`tsc\` nor the bundle build can
 * see. 0.11.3 cost exactly that gap — the first installed pass restored the content correctly, re-read
 * the rows correctly, and never showed the curator's sentence, because the reload that follows a
 * restore cleared the state it had just set. Only rendering the component shows the order of two
 * state updates.
 *
 * The face is a plain fixture: the panel takes copy plus callbacks and never sees the context, so a
 * spec drives it exactly like the slot renderer does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { skillRowCells, versionRowCells } from '@deepseek-ai/dsh-evolution-core'
import { SkillHistoryPanel, type PanelFace } from '../src/client/Panel.ts'
import type { SkillRow, VersionRow, VersionsPayload } from '../src/client/api.ts'

/** One in-flight read a spec resolves by hand. */
interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

const skill = (name: string, versions: number, description: string, lastAt: string, age: { unit: string; n: number }): SkillRow => {
  const facts = { name, versions, description, managed: true, protectedBy: null, protectionUnknown: false, age }
  return { ...facts, lastAt, cells: skillRowCells(facts) }
}

const skills: readonly SkillRow[] = [
  skill('alpha', 2, 'first skill', 'T2', { unit: 'hours', n: 3 }),
  skill('beta', 1, 'second skill', 'T1', { unit: 'days', n: 1 }),
]

const row = (v: number, undoable: boolean): VersionRow => {
  const facts = { v, actionKind: 'update', age: { unit: 'hours', n: v } }
  return {
    ...facts, at: '2026-09-27T10:00:00Z', action: 'update', hash: 'h' + String(v), chars: 10, undoable,
    cells: versionRowCells(facts),
  }
}

const payload = (): VersionsPayload => ({ content: [row(1, true), row(2, false)], support: [], liveHash: 'h2' })

/** The face as the slot renderer hands it over: keys as words, so assertions name the exact copy. */
function makeFace(overrides: Partial<PanelFace> = {}): PanelFace {
  return {
    t: key => key,
    format: (key, values) => key + '(' + Object.values(values).join(',') + ')',
    markdownWords: { copy: 'copy', copied: 'copied', footnotes: 'footnotes' },
    loadSkills: async () => skills,
    loadVersions: async () => payload(),
    loadDiff: async () => ({ v: 1, against: null, linesAdded: 0, linesRemoved: 0, hunks: [], truncated: false }),
    loadBody: async () => ({ v: 1, display: '# one', chars: 5, truncated: false }),
    undo: async () => 'UNDONE',
    ...overrides,
  }
}

/** Open one skill and settle its rows, so a spec starts where the interesting part begins. */
async function openSkill(name: string): Promise<void> {
  fireEvent.click(await screen.findByText(name))
  await waitFor(() => { expect(screen.getByRole('button', { name: 'undo' })).toBeTruthy() })
}

afterEach(cleanup)

describe('skill-history panel: the state machine a renderer can see', () => {
  it('keeps the curator\'s sentence while the rows are read again', async () => {
    const reads: Array<Deferred<VersionsPayload>> = []
    render(createElement(SkillHistoryPanel, makeFace({
      loadVersions: () => { const next = deferred<VersionsPayload>(); reads.push(next); return next.promise },
      undo: async () => 'UNDONE',
    })))
    fireEvent.click(await screen.findByText('alpha'))
    await waitFor(() => { expect(reads).toHaveLength(1) })
    reads[0]!.resolve(payload())
    await screen.findByRole('button', { name: 'undo' })
    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'undo.confirm' }))
    await screen.findByText('UNDONE')
    // The re-read the restore itself triggered lands AFTER the sentence: it must not clear it.
    await waitFor(() => { expect(reads.length).toBeGreaterThan(1) })
    reads[1]!.resolve(payload())
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(screen.getByText('UNDONE')).toBeTruthy()
  })

  it('arms the undo on the first click, cancels on demand, and writes only on the confirm', async () => {
    const undo = vi.fn(async () => 'UNDONE')
    render(createElement(SkillHistoryPanel, makeFace({ undo })))
    await openSkill('alpha')
    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    expect(screen.getByRole('button', { name: 'undo.confirm' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'undo.no' }))
    expect(screen.getByRole('button', { name: 'undo' })).toBeTruthy()
    expect(undo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'undo.confirm' }))
    await waitFor(() => { expect(undo).toHaveBeenCalledTimes(1) })
  })

  it('discards a late rows reply for a skill the operator has already left', async () => {
    const slow = deferred<VersionsPayload>()
    render(createElement(SkillHistoryPanel, makeFace({
      loadVersions: name => name === 'alpha' ? slow.promise : Promise.resolve({ content: [row(9, false)], support: [], liveHash: 'h9' }),
    })))
    fireEvent.click(await screen.findByText('alpha'))
    fireEvent.click(screen.getByText('beta'))
    await screen.findByText('row.version(9)')
    slow.resolve(payload())
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(screen.getByText('row.version(9)')).toBeTruthy()
    expect(screen.queryByText('row.version(1)')).toBeNull()
  })

  it('reads a preview again when a later toggle superseded it, instead of waiting forever', async () => {
    // The 0.14.0 review's P1-1: the superseded read left a `loading` entry in the cache, and the
    // cache doubles as the "do not read twice" guard — so that row said "loading" until a reload.
    const slow = deferred<{ v: number; display: string; chars: number; truncated: boolean }>()
    let firstRead = true
    const loadBody = vi.fn((_name: string, v: number) => {
      if (v !== 1) return Promise.resolve({ v, display: '# two', chars: 5, truncated: false })
      const answer = firstRead
        ? slow.promise
        : Promise.resolve({ v: 1, display: '# one', chars: 5, truncated: false })
      firstRead = false
      return answer
    })
    render(createElement(SkillHistoryPanel, makeFace({ loadBody })))
    await openSkill('alpha')
    const previews = (): HTMLElement[] => screen.getAllByRole('button', { name: /^preview\./ })
    fireEvent.click(previews()[0]!)
    await waitFor(() => { expect(loadBody).toHaveBeenCalledWith('alpha', 1) })
    fireEvent.click(previews()[1]!)
    await screen.findByText('# two')
    // The abandoned reply lands late: it must leave nothing behind, or the row is dead.
    slow.resolve({ v: 1, display: 'late', chars: 4, truncated: false })
    await new Promise(resolve => setTimeout(resolve, 10))
    fireEvent.click(previews()[0]!)
    await waitFor(() => { expect(loadBody).toHaveBeenLastCalledWith('alpha', 1) })
    await screen.findByText('# one')
    expect(screen.queryByText('late')).toBeNull()
  })

  it('points at the left column while nothing is selected, and reports a refusal', async () => {
    const view = render(createElement(SkillHistoryPanel, makeFace({
      loadVersions: async () => { throw new Error('boom') },
    })))
    // Before the listing lands there is nothing to point at; once it does, the pane says so.
    await screen.findByText('alpha')
    expect(screen.getByText('empty.pick')).toBeTruthy()
    fireEvent.click(screen.getByText('alpha'))
    await screen.findByText(/boom/)
    await waitFor(() => { expect(view.queryByText('empty.pick')).toBeNull() })
  })
})
