import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { clearReviewChannel, markReviewChannel } from '@deepseek-ai/dsh-evolution-core'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { runReview } from '../src/review-executor.ts'
import type { ReviewLlmPort, ReviewToolPort } from '../src/review-executor.ts'
import { executeTool } from './support/execute-tool.ts'

const parents = new Set<SessionId>()

afterEach(() => {
  for (const id of parents) clearReviewChannel(id)
  parents.clear()
})

function waitForIdle(ctx: Context, agent: { status: string; session: { id: SessionId } }): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject.session.id === agent.session.id && status === 'idle') { dispose(); resolve() }
    })
  })
}

describe('review executor over a real ToolsService', () => {
  it('executes an allowlisted tool with the parent Agent and no parent append', async () => {
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      let seenAgent: unknown
      let toolRuns = 0
      ctx.tools.register(defineTool({
        name: 'probe',
        description: 'capture review tool context',
        parameters: {},
        output: { schema: { type: 'null' }, render: () => [] },
        async execute(_args, exec) {
          toolRuns += 1
          seenAgent = exec.agent
          return null
        },
      }))
      const adapter = new MockAdapter([
        textResponse('parent answer'),
        toolCallResponse('probe-1', 'probe', {}),
        textResponse('review answer'),
      ])
      ctx.llm.registerAdapter(['mock'], adapter)
      const parent = await ctx.agentLoop.create(SessionId('aux-real-parent'), { provider: 'mock', model: 'mock' })
      parents.add(parent.session.id)
      parent.followup(createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, parent)
      const before = parent.session.seq
      const llm: ReviewLlmPort = { stream: options => adapter.stream(options) }
      const tools: ReviewToolPort = {
        execute: async input => {
          const results = []
          for (const call of input.calls) {
            const result = await executeTool(ctx, parent, call.id, call.name, call.arguments, input.signal)
            results.push({ callId: call.id, result })
          }
          return { results }
        },
      }
      const result = await runReview({
        parent,
        llm,
        tools,
        instruction: 'review',
        toolAllow: new Set(['probe']),
        signal: new AbortController().signal,
        markReview: () => markReviewChannel(parent.session.id),
        clearReview: () => clearReviewChannel(parent.session.id),
      })
      expect(toolRuns).toBe(1)
      expect(seenAgent).toBe(parent)
      expect(result.actions).toEqual([{ type: 'tool', action: 'probe', target: 'probe', status: 'ok' }])
      expect(parent.session.seq).toBe(before)
      expect(ctx.sessions.list().map(session => session.id)).toEqual([parent.session.id])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
