// @tier fast
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { EvolutionLlmError, llmPort } from '../src/llm.ts'
import type { EvolutionLlmRequest } from '@deepseek-ai/dsh-evolution-platform-contract'

function contextWith(chunks: readonly StreamChunk[]): Context {
  const ctx = new Context()
  ctx.provide('llm' as never, {
    stream: async function* (): AsyncIterable<StreamChunk> {
      yield* chunks
    },
  } as never)
  return ctx
}

const REQUEST: EvolutionLlmRequest = {
  provider: 'test-provider',
  model: 'test-model',
  purpose: 'evolution-curator',
  messages: [],
}

it('completeText returns the accumulated text for a normal stop', async () => {
  const port = llmPort(contextWith([
    { type: 'text-delta', index: 0, text: 'hello ' },
    { type: 'text-delta', index: 0, text: 'world' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]))
  expect(port).toBeDefined()
  await expect(port!.completeText(REQUEST)).resolves.toBe('hello world')
})

it('completeText maps an aborted finish to cancelled instead of returning half text', async () => {
  const port = llmPort(contextWith([
    { type: 'text-delta', index: 0, text: 'half' },
    { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted by caller', code: 'ABORTED' } } },
  ]))
  await expect(port!.completeText(REQUEST)).rejects.toMatchObject({ kind: 'cancelled' })
})

it('completeText preserves content-refused and timeout failure kinds', async () => {
  const refused = llmPort(contextWith([
    { type: 'finish', reason: { kind: 'error', failure: { message: 'refused', code: 'CONTENT_REFUSED' } } },
  ]))
  await expect(refused!.completeText(REQUEST)).rejects.toMatchObject({ kind: 'content-refused' })

  const timeout = llmPort(contextWith([
    { type: 'finish', reason: { kind: 'error', failure: { message: 'timed out', code: 'TIMEOUT' } } },
  ]))
  await expect(timeout!.completeText(REQUEST)).rejects.toMatchObject({ kind: 'timeout' })
})

it('completeText refuses a stream that ends without a finish frame', async () => {
  const port = llmPort(contextWith([{ type: 'text-delta', index: 0, text: 'partial' }]))
  await expect(port!.completeText(REQUEST)).rejects.toBeInstanceOf(EvolutionLlmError)
  await expect(port!.completeText(REQUEST)).rejects.toMatchObject({ kind: 'transport' })
})
