// @tier pre-tag
import { expect, it } from 'vitest'
import { subagentChannelAdapter, type SubagentChannelLike } from '../src/index.ts'

const signal = new AbortController().signal

it('maps child ids and turns; missing optional methods degrade', async () => {
  let disposed = ''
  const channel: SubagentChannelLike = {
    async open() { return { kind: 'ok', childId: 42, turn: { childId: 42, stopReason: 'completed', text: 'decision' } } },
    async continueTurn() { return { kind: 'ok', childId: 42, turn: { childId: 42, stopReason: 'completed', text: 'written' } } },
    async dispose(id) { disposed = id },
  }
  const adapted = subagentChannelAdapter(channel)
  const opened = await adapted.open({ parent: {}, label: 'x', promptText: 'p', kind: 'reviewer', allow: [], timeoutMs: 1, signal })
  expect(opened).toEqual({ kind: 'ok', childId: '42', turn: { text: 'decision', stopReason: 'completed' } })
  expect(await adapted.continueTurn?.('42', 'next', { signal })).toMatchObject({ kind: 'ok', childId: '42' })
  await adapted.dispose('42')
  expect(disposed).toBe('42')

  const withUsage = subagentChannelAdapter({
    async open() { return { kind: 'ok', childId: 7, turn: { childId: 7, stopReason: 'completed', text: 'x', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } } },
  })
  expect(await withUsage.open({ parent: {}, label: 'x', promptText: 'p', kind: 'reviewer', allow: [], timeoutMs: 1, signal })).toMatchObject({ turn: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } })

  const weak = subagentChannelAdapter({})
  expect(await weak.open({ parent: {}, label: 'x', promptText: 'p', kind: 'reviewer', allow: [], timeoutMs: 1, signal })).toMatchObject({ kind: 'unavailable', code: 'E-323' })
})
