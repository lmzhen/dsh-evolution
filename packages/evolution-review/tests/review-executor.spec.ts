// @tier fast
import { describe, expect, it } from 'vitest'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { runReview } from '../src/review-executor.ts'
import { nativeReviewToolChannel } from '../src/review-tool-channel.ts'
import type { ReviewLlmPort, ReviewParent, ReviewToolPort } from '../src/review-executor.ts'
import { withReviewContext } from '@deepseek-ai/dsh-evolution-core'

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
      if (input.agent !== undefined) seen.agent = input.agent
      return { results: [{ callId: call.id, result: { content: [{ type: 'text' as const, text: 'ok' }] as ContentBlock[], isError: false } }] }
    },
  }
}

const doneCall = { type: 'tool-call' as const, id: ToolCallId('done-1'), name: 'review_done', arguments: JSON.stringify({ summary: 'done', memoryChanged: false, skillsChanged: ['probe'], unresolved: [] }) }
const doneChunks: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: doneCall },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]

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

  it('records a successful skill read in the review run context', async () => {
    const skillCall = { type: 'tool-call' as const, id: ToolCallId('read-call'), name: 'skill', arguments: '{"name":"read-skill"}' }
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: skillCall },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
    const reads = new Set<string>()
    await withReviewContext({ reviewId: 'read-review', runId: 'read-review', reads }, async () => {
      await runReview({
        parent: parent(),
        llm: llm([chunks, textChunks]),
        tools: {
          async execute() {
            return { results: [{ callId: skillCall.id, result: { content: [{ type: 'text' as const, text: 'loaded' }], isError: false } }] }
          },
        },
        instruction: 'review',
        toolAllow: new Set(['skill']),
        signal: new AbortController().signal,
        markReview: () => {},
        clearReview: () => {},
      })
    })
    expect(reads.has('read-skill')).toBe(true)
  })

  it('completes only after an explicit review_done tool call', async () => {
    const result = await runReview({
      parent: parent(),
      llm: llm([toolCallChunks, doneChunks]),
      tools: tools({}),
      instruction: 'review',
      toolAllow: allowed(),
      signal: new AbortController().signal,
      markReview: () => {},
      clearReview: () => {},
    })
    expect(result.done).toBe(true)
    expect(result.partialReason).toBeUndefined()
    expect(result.report).toEqual({ summary: 'done', memoryChanged: false, skillsChanged: ['probe'], unresolved: [] })
    expect(result.toolCalls).toBe(2)
  })

  it('marks a review without review_done partial', async () => {
    const result = await runReview({
      parent: parent(),
      llm: llm([textChunks]),
      tools: tools({}),
      instruction: 'review',
      toolAllow: allowed(),
      signal: new AbortController().signal,
      markReview: () => {},
      clearReview: () => {},
    })
    expect(result.done).toBe(false)
    expect(result.partialReason).toBe('missing review_done')
  })

  it('marks round exhaustion partial instead of completed', async () => {
    const result = await runReview({
      parent: parent(),
      llm: llm([toolCallChunks]),
      tools: tools({}),
      instruction: 'review',
      toolAllow: allowed(),
      maxRounds: 1,
      signal: new AbortController().signal,
      markReview: () => {},
      clearReview: () => {},
    })
    expect(result.done).toBe(false)
    expect(result.hitRoundLimit).toBe(true)
    expect(result.partialReason).toBe('max review rounds reached before review_done')
  })

  it('executes a native review channel without bypassing the runner', async () => {
    const seen: { agent?: ReviewParent } = {}
    const channel = nativeReviewToolChannel(parent(), allowed(), tools(seen))
    expect(channel.mode).toBe('native')
    expect(channel.visibleTools.map(tool => tool.name)).toEqual(['skill_manage'])
    const result = await runReview({
      parent: parent(),
      llm: llm([toolCallChunks, doneChunks]),
      tools: tools({}),
      channel,
      instruction: 'review',
      toolAllow: allowed(),
      signal: new AbortController().signal,
      markReview: () => {},
      clearReview: () => {},
    })
    expect(result.done).toBe(true)
    expect(result.actions[0]).toMatchObject({ action: 'skill_manage', status: 'ok' })
  })

  it('rejects review_done mixed with other calls', async () => {
    const mixed: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: call },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'block-end', index: 1, block: doneCall },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
    const result = await runReview({
      parent: parent(),
      llm: llm([mixed]),
      tools: tools({}),
      instruction: 'review',
      toolAllow: allowed(),
      signal: new AbortController().signal,
      markReview: () => {},
      clearReview: () => {},
    })
    expect(result.done).toBe(false)
    expect(result.partialReason).toBe('review_done must be the only tool call in its batch')
  })
})

