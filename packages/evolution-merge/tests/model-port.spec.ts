// @tier pre-tag
import { expect, it } from 'vitest'
import { createModelPort, type LlmServiceLike } from '../src/adapters/model.ts'

const signal = new AbortController().signal

it('returns raw model text and passes route/temperature', async () => {
  let config: Record<string, unknown> | undefined
  const llm: LlmServiceLike = {
    async prepareCall(input) {
      config = input
      return {
        config: { provider: input.provider, model: input.model },
        async *stream() {
          yield { type: 'text-delta', text: '{"pairs":' }
          yield { type: 'text-delta', text: '[]}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  const port = createModelPort(llm, () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }))
  const text = await port.callJson({ system: 's', user: 'u', maxTokens: 100, signal })
  expect(text).toBe('{"pairs":[]}')
  expect(config).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 100, temperature: 0 })
})

it('uses the current llm.stream shape', async () => {
  const llm: LlmServiceLike = {
    async *stream() {
      yield { type: 'text-delta', text: 'hello' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const port = createModelPort(llm, () => ({ provider: 'p', model: 'm' }))
  expect(await port.callJson({ system: 's', user: 'u', maxTokens: 10, signal })).toBe('hello')
})

it('throws on a finish error', async () => {
  const llm: LlmServiceLike = {
    async prepareCall() {
      return {
        config: {},
        async *stream() {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }
        },
      }
    },
  }
  const port = createModelPort(llm, () => ({ provider: 'p', model: 'm' }))
  await expect(port.callJson({ system: 's', user: 'u', maxTokens: 10, signal })).rejects.toThrow('boom')
})
