// @tier fast
import { expect, it } from 'vitest'
import { withReviewContext } from '@deepseek-ai/dsh-evolution-core'
import type { ToolDefinition } from '@deepseek-ai/dsh-evolution-adapter/values'
import { PtcReviewToolHost } from '../src/review-ptc-channel.ts'
import { ReviewWriteLocks } from '../src/review-write-locks.ts'

it('exposes review_done only while the PTC channel executes and reports completion', async () => {
  const registered: ToolDefinition[] = []
  const host = new PtcReviewToolHost({
    register(definition) { registered.push(definition); return () => { registered.splice(registered.indexOf(definition), 1) } },
    resolve: async () => ({ marker: 'review-toolset' }),
    async execute(input: unknown) {
      expect((input as { toolSet?: unknown }).toolSet).toEqual({ marker: 'review-toolset' })
      const done = registered.find(definition => definition.name === 'review_done')
      expect(done).toBeDefined()
      await done!.execute({ summary: 'done', memoryChanged: false, skillsChanged: ['probe'], unresolved: [] }, { signal: new AbortController().signal } as never)
      return { results: [] }
    },
  }, new ReviewWriteLocks())
  const channel = host.channel('review-1', [{ name: 'run_code' }], {})
  expect(channel.mode).toBe('ptc')
  expect(channel.visibleTools.map(tool => tool.name)).toEqual(['run_code'])
  expect(registered.map(definition => definition.name)).toEqual(['review_done', 'review_wait'])
  await withReviewContext({ reviewId: 'review-1', runId: 'review-1', reads: new Set<string>() }, () => channel.execute([], new AbortController().signal))
  expect(registered).toHaveLength(2)
  channel.dispose()
  expect(registered).toHaveLength(2)
  expect(channel.completion()).toMatchObject({ done: true, report: { summary: 'done' } })
  host.dispose()
  expect(registered).toHaveLength(0)
})
