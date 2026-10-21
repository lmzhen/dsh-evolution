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
