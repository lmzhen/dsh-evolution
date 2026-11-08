import { describe, expect, it } from 'vitest'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, StreamChunk, ToolCallBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { runReview } from '../src/review-executor.ts'
import type { ReviewLlmPort, ReviewParent, ReviewToolPort } from '../src/review-executor.ts'

const call = { type: 'tool-call' as const, id: ToolCallId('call-1'), name: 'skill_manage', arguments: '{"name":"probe"}' }
const toolCallChunks: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: call },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
const textChunks: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'done' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

function parent(): ReviewParent {
  const header = {
    config: { provider: 'mock', model: 'mock' },
    tools: [{ name: 'skill_manage', description: 'skill', parameters: {} }],
  } as EpochHeader
  return {
    id: SessionId('parent'),
    status: 'idle',
    session: {
      id: SessionId('parent'),
      seq: 7,
      requestHeader: () => header,
      deriveMessages: () => [createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } })] as Message[],
      toolHistory: () => undefined,
    },
  }
}

function llm(script: StreamChunk[][]): ReviewLlmPort & { requests: unknown[] } {
  const requests: unknown[] = []
  return {
    requests,
    stream(options) {
      expect('sessionId' in (options as object)).toBe(false)
      requests.push(options)
      const next = script.shift()
      if (next === undefined) throw new Error('unexpected request')
      return (async function* () { for (const chunk of next) yield chunk })()
    },
  }
}

function tools(seen: { agent?: ReviewParent }): ReviewToolPort {
  return {
    async execute(input) {
      seen.agent = input.agent
      return { results: [{ callId: call.id, result: { content: [{ type: 'text' as const, text: 'ok' }] as ContentBlock[], isError: false } }] }
    },
  }
}

function allowed(): ReadonlySet<string> {
  return new Set(['skill_manage'])
}

describe('runReview', () => {
  it('runs a bounded tool loop in the parent prefix without appending', async () => {
    const p = parent()
    const port = llm([toolCallChunks, textChunks])
    const seen: { agent?: ReviewParent } = {}
    let marked = 0
    let cleared = 0
    const result = await runReview({
      parent: p,
      llm: port,
      tools: tools(seen),
      instruction: 'review',
      toolAllow: allowed(),
      signal: new AbortController().signal,
      markReview: () => { marked += 1 },
      clearReview: () => { cleared += 1 },
    })
    expect(marked).toBe(1)
    expect(cleared).toBe(1)
    expect(seen.agent).toBe(p)
    expect(result.finalText).toBe('done')
    expect(result.toolCalls).toBe(1)
    expect(result.requests).toBe(2)
    expect(result.actions).toEqual([{ type: 'skill', action: 'skill_manage', target: 'probe', status: 'ok' }])
    expect(result.usage?.cacheReadTokens).toBe(3)
    expect(p.session.seq).toBe(7)
  })

  it('returns an error result for a tool outside the allowlist and clears the mark', async () => {
    let cleared = 0
    const seen: { agent?: ReviewParent } = {}
    const result = await runReview({
      parent: parent(),
      llm: llm([toolCallChunks, textChunks]),
      tools: tools(seen),
      instruction: 'review',
      toolAllow: new Set(),
      signal: new AbortController().signal,
      markReview: () => {},
      clearReview: () => { cleared += 1 },
    })
    expect(result.actions).toEqual([{ type: 'skill', action: 'skill_manage', target: 'probe', status: 'error' }])
    expect(result.finalText).toBe('done')
    expect(seen.agent).toBeUndefined()
    expect(cleared).toBe(1)
  })
})
