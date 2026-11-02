// @tier pre-tag
import { expect, it } from 'vitest'
import { createEngineRunner } from '../src/index.ts'

it('collects platform text chunks and passes provider/model', async () => {
  const calls: Record<string, unknown>[] = []
  const runner = createEngineRunner({
    async *stream(options) {
      calls.push(options)
      yield { type: 'text-delta', text: '{"verdict":' }
      yield { type: 'text-delta', text: '-1}' }
    },
  }, () => ({ provider: 'deepseek', model: 'deepseek-flash' }))
  expect(await runner('prompt')).toBe('{"verdict":-1}')
  expect(calls[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', temperature: 0 })
})

it('P2-19: forwards the run signal and cfg timeout to the provider', async () => {
  const calls: Record<string, unknown>[] = []
  const runner = createEngineRunner({
    async *stream(options) {
      calls.push(options)
      yield { type: 'text-delta', text: 'ok' }
    },
  }, () => ({ provider: 'deepseek', model: 'deepseek-flash' }))
  const controller = new AbortController()
  expect(await runner('prompt', { timeoutMs: 1000 }, controller.signal)).toBe('ok')
  expect(calls[0]?.signal).toBeDefined()
  controller.abort()
  expect(await runner('prompt', { timeoutMs: 1000 }, controller.signal)).toBe('ok')
  expect((calls[1]?.signal as AbortSignal).aborted).toBe(true)
})
