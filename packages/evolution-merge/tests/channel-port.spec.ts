// @tier pre-tag
import { expect, it } from 'vitest'
import { runRound1OverChannel, type ConversationChannelLike, type MergeRow, type SkillCard } from '../src/index.ts'

const cards: SkillCard[] = [
  { name: 'alpha-skill', description: 'a', body: 'a' },
  { name: 'beta-skill', description: 'b', body: 'b' },
]
const candidate = { a: 'alpha-skill', b: 'beta-skill' }
const row: MergeRow = { id: '', pairKey: 'a\u0000b', a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'fuse', createdAt: '', updatedAt: '' }
const signal = new AbortController().signal
const mergeText = JSON.stringify({ should_merge: true, mode: 'merge-into-existing', target: 'alpha-skill', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' })

function channel(text: string, cacheRead?: number): ConversationChannelLike & { disposed: number; continued: number } {
  const state = { disposed: 0, continued: 0, first: true }
  return {
    ...state,
    async open() { return { kind: 'ok' as const, childId: 'child-1', turn: { text: 'standby', stopReason: 'completed' } } },
    async continueTurn() {
      this.continued += 1
      const reply = this.first ? text : 'written'
      const turn = { text: reply, stopReason: 'completed', ...(this.first && cacheRead !== undefined ? { cacheRead } : {}) }
      this.first = false
      return { kind: 'ok' as const, childId: 'child-1', turn }
    },
    async dispose() { this.disposed += 1 },
  }
}

it('opens standby, binds, sends round1 and exposes same-child author', async () => {
  const fake = channel(mergeText)
  let bound = 0
  const result = await runRound1OverChannel(
    { channel: fake, parent: {}, cards, allow: [], timeoutMs: 1000, onChildOpened: () => { bound += 1 } },
    candidate,
    signal,
  )
  expect(result.outcome).toMatchObject({ kind: 'merge', decision: { shouldMerge: true } })
  expect(result.childId).toBe('child-1')
  expect(bound).toBe(1)
  expect(await result.author?.(row, { shouldMerge: true, mode: 'merge-into-existing', target: 'alpha-skill', sources: ['alpha-skill', 'beta-skill'], rationale: 'same' }, signal)).toBe('written')
  await result.dispose()
  await result.dispose()
  expect(fake.continued).toBe(2)
  expect(fake.disposed).toBe(1)
})

it('carries cacheRead into the decision observation', async () => {
  const fake = channel(mergeText, 1234)
  const result = await runRound1OverChannel({ channel: fake, parent: {}, cards, allow: [], timeoutMs: 1000 }, candidate, signal)
  expect(result.outcome).toMatchObject({ kind: 'merge', decision: { cacheRead: 1234 } })
  await result.dispose()
})

it('disposes immediately for keep and invalid decisions', async () => {
  const keep = channel(JSON.stringify({ should_merge: false, mode: 'keep' }))
  expect((await runRound1OverChannel({ channel: keep, parent: {}, cards, allow: [], timeoutMs: 1000 }, candidate, signal)).outcome.kind).toBe('keep')
  expect(keep.disposed).toBe(1)
  const bad = channel('not json')
  expect((await runRound1OverChannel({ channel: bad, parent: {}, cards, allow: [], timeoutMs: 1000 }, candidate, signal)).outcome.kind).toBe('failed')
  expect(bad.disposed).toBe(1)
})
