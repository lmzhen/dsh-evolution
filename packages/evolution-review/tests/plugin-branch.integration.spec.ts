// @tier fast
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Review from '../src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

it('creates a no-cwd plugin branch and disposes it', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('DONE'), textResponse('branch summary')]))
    const harness = await mountAgentLoopTestHarness(ctx)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) } as never)
    ctx.provide('evolutionState', {
      loadReviewState: async () => null,
      saveReviewState: async () => undefined,
    } as never)
    ctx.provide('evolutionPolicy', {
      get: () => ({
        reviewMode: 'branch',
        reviewMemoryInterval: 1,
        reviewSkillInterval: 100,
        substantiveMinToolCalls: 1,
        substantiveMinUserChars: 1,
        substantiveMinAgentChars: 1,
      }),
    } as never)
    const created: Array<{ id: SessionId; session: { header: { cwd?: string; parentSession?: SessionId } } }> = []
    ctx.on('agent/created', ({ agent }) => { created.push(agent as never) })
    let parent: import('@deepseek-ai/dsh-agent').Agent
    ctx.provide('sessionQuery', { readEvents: async () => parent.session.snapshotEvents() } as never)
    const completed: unknown[] = []
    ctx.on('evolution/review-completed', event => completed.push(event))
    await ctx.plugin(Review, {
      reviewEnabled: true,
      reviewMemoryInterval: 1,
      reviewSkillInterval: 100,
      skillReviewTrigger: 'cadence',
      reviewMode: 'branch',
    })
    parent = await harness.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'do the task' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    await vi.waitFor(() => { expect(completed).toHaveLength(1) })
    const child = created.find(agent => agent.id !== parent.id)
    expect(child).toBeDefined()
    expect(child?.session.header.cwd).toBeUndefined()
    expect(child?.session.header.parentSession).toBe(parent.id)
    expect(ctx.agents.get(child!.id)).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})
