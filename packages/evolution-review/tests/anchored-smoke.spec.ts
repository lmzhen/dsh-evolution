import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Review from '../src/index.ts'

const anchoredEntry = fileURLToPath(new URL('../../test-support/anchored-standard/tool-bootstrap.mjs', import.meta.url))
const Anchored = await import(pathToFileURL(anchoredEntry).href) as { apply(ctx: Context, config?: unknown): Promise<void> | void }

describe('anchored-standard review smoke', () => {
  it('starts a review subagent with the anchored discovery tool set', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    // Real anchored-standard bootstrap plugin: mounted first, as in its preset.
    await ctx.plugin(Anchored, {
      bootstrapTools: ['bash', 'str_replace_editor'],
      promoteOn: 'either',
      suppressedContextSources: ['agent-instructions', 'skill-catalog'],
    })

    let capturedRequest: unknown
    ctx.provide('subagents', {
      start: async (_name: string, request: unknown) => {
        capturedRequest = request
        return {
          result: Promise.resolve({ structured: null }),
          dispose: async () => {},
        }
      },
    })

    await ctx.plugin(Review, {
      reviewEnabled: true,
      reviewMode: 'subagent',
      memoryInterval: 1,
      skillInterval: 1,
    })

    const session = ctx.sessions.create(SessionId('anchored-review-session'))
    const agent = {
      id: session.id,
      session,
      ctx,
      inject: () => {},
    } as unknown as Agent
    ctx.agents.register(agent)

    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{
        type: 'text',
        text: 'I prefer concise answers and want you to remember that preference. '.repeat(6),
      }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(capturedRequest).toBeDefined()
    const request = capturedRequest as Record<string, unknown> | undefined
    // The DSH tool catalog exposes `skill` only — discovery tools don't exist,
    // so the default allow list is exactly the real tool set.
    expect(request?.toolFilter).toEqual({ allow: ['skill'] })
    // No reviewProvider config: the subagent inherits the deployment default
    // route instead of a hardcoded provider name.
    expect((request?.agentOptions as Record<string, unknown> | undefined)?.provider).toBeUndefined()
    expect(typeof (request?.agentOptions as Record<string, unknown> | undefined)?.model).toBe('string')
  })
})
