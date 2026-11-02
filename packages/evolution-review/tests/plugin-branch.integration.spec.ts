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
    const applied: unknown[] = []
    ctx.on('evolution/plan-applied', event => applied.push(event))
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
    await vi.waitFor(() => { expect(applied).toHaveLength(1) })
    const child = created.find(agent => agent.id !== parent.id)
    expect(child).toBeDefined()
    expect(child?.session.header.cwd).toBeUndefined()
    expect(child?.session.header.parentSession).toBe(parent.id)
    expect(ctx.agents.get(child!.id)).toBeUndefined()
    expect(applied[0]).toMatchObject({ sessionId: String(parent.id), planId: String(child!.id), memoryApplied: 0, skillApplied: 0, rejectedOps: 0 })
  } finally {
    await ctx.fiber.dispose()
  }
})
it('P1-9: a hung branch child times out, cancels, and disposes', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('DONE'), 'hang']))
    const harness = await mountAgentLoopTestHarness(ctx)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) } as never)
    ctx.provide('evolutionState', { loadReviewState: async () => null, saveReviewState: async () => undefined } as never)
    ctx.provide('evolutionPolicy', { get: () => ({ reviewMode: 'branch', reviewMemoryInterval: 1, reviewSkillInterval: 100, substantiveMinToolCalls: 1, substantiveMinUserChars: 1, substantiveMinAgentChars: 1 }) } as never)
    const completed: Array<{ status?: string }> = []
    ctx.on('evolution/review-completed', event => completed.push(event as { status?: string }))
    const created: Array<{ id: SessionId }> = []
    ctx.on('agent/created', ({ agent }) => { created.push(agent as never) })
    await ctx.plugin(Review, { reviewEnabled: true, reviewMemoryInterval: 1, reviewSkillInterval: 100, skillReviewTrigger: 'cadence', reviewMode: 'branch', reviewTimeoutMs: 30 })
    const parent = await harness.create(SessionId('parent-timeout'), { provider: 'mock', model: 'mock' })
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'do the task' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    await vi.waitFor(() => { expect(completed).toHaveLength(1) }, { timeout: 3000 })
    expect(completed[0]?.status).toBe('timeout')
    const child = created.find(agent => agent.id !== parent.id)
    expect(child).toBeDefined()
    expect(ctx.agents.get(child!.id)).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})

