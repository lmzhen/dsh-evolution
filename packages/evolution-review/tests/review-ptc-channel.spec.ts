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
    resolve: async () => ({ view: () => new Map([['run_code', {}], ['skill_manage', {}], ['review_done', {}], ['bash', {}]]) }),
    async execute(input: unknown) {
      const toolSet = (input as { toolSet?: { view(scope?: unknown): ReadonlyMap<string, unknown> } }).toolSet
      expect(toolSet === undefined ? [] : [...toolSet.view(undefined).keys()]).toEqual(['run_code', 'skill_manage', 'review_done'])
      const done = registered.find(definition => definition.name === 'review_done')
      expect(done).toBeDefined()
      await done!.execute({ summary: 'done', memoryChanged: false, skillsChanged: ['probe'], unresolved: [] }, { signal: new AbortController().signal } as never)
      return { results: [] }
    },
  }, new ReviewWriteLocks())
  const channel = await host.channel('review-1', [{ name: 'run_code' }], {}, undefined, new Set(['run_code', 'skill_manage', 'review_done', 'review_wait']))
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

it('resolves review_done from the child session when the ALS context is gone', async () => {
  const registered: ToolDefinition[] = []
  const childAgent = { session: { id: 'review-child:aux-review-2:0' } }
  const host = new PtcReviewToolHost({
    register(definition) { registered.push(definition); return () => {} },
    resolve: async () => ({ view: () => new Map([['run_code', {}], ['review_done', {}]]) }),
    async execute() {
      const done = registered.find(definition => definition.name === 'review_done')!
      await done.execute({ summary: 'done', memoryChanged: false, skillsChanged: [], unresolved: [] }, { signal: new AbortController().signal, agent: childAgent } as never)
      return { results: [] }
    },
  }, new ReviewWriteLocks())
  const channel = await host.channel('aux-review-2', [{ name: 'run_code' }], childAgent, undefined, new Set(['run_code', 'review_done', 'review_wait']))
  await channel.execute([], new AbortController().signal)
  expect(channel.completion()).toMatchObject({ done: true, report: { summary: 'done' } })
  channel.dispose(); host.dispose()
})

it('resolves and executes the nested PTC SDK with the same child agent', async () => {
  let resolvedAgent: unknown
  let executedAgent: unknown
  const host = new PtcReviewToolHost({
    register() { return () => {} },
    resolve: async context => {
      resolvedAgent = (context as { agent?: unknown }).agent
      return { view: () => new Map([['skill_manage', {}], ['read', {}], ['bash', {}]]) }
    },
    async execute(input: unknown) {
      executedAgent = (input as { agent?: unknown }).agent
      return { results: [] }
    },
  }, new ReviewWriteLocks())
  const child = { session: { id: 'review-child:aux-review-3:0' } }
  const parent = { session: { id: 'parent-review-3' } }
  const channel = await host.channel('aux-review-3', [{ name: 'run_code' }], child, undefined, new Set(['skill_manage', 'read']))
  await channel.execute([], new AbortController().signal)
  expect(resolvedAgent).toBe(child)
  expect(executedAgent).toBe(child)
  channel.dispose(); host.dispose()
})
