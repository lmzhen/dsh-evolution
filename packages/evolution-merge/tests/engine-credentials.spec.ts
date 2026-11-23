// @tier pre-tag
import { afterEach, expect, it } from 'vitest'
import { screen } from '@deepseek-ai/dsh-evolution-merge-engine'

const ENV_KEYS = ['SILICONFLOW_API_KEY', 'BAMBOO_API_KEY'] as const
const previous = new Map<string, string | undefined>()

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previous.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
    previous.delete(key)
  }
})

it('passes explicit keys as runtime input without writing process.env', async () => {
  for (const key of ENV_KEYS) previous.set(key, process.env[key])
  delete process.env.SILICONFLOW_API_KEY
  delete process.env.BAMBOO_API_KEY

  const result = await screen({ corpusDir: '', outDir: '', credentials: { embedding: 'sf-ui', ranker: 'bamboo-ui' } })
  expect(result.ok).toBe(false)
  expect(process.env.SILICONFLOW_API_KEY).toBeUndefined()
  expect(process.env.BAMBOO_API_KEY).toBeUndefined()
})

it('keeps ambient env values untouched when explicit keys are provided', async () => {
  for (const key of ENV_KEYS) previous.set(key, process.env[key])
  process.env.SILICONFLOW_API_KEY = 'ambient-sf'
  delete process.env.BAMBOO_API_KEY

  await screen({ corpusDir: '', outDir: '', credentials: { embedding: 'sf-ui' } })
  expect(process.env.SILICONFLOW_API_KEY).toBe('ambient-sf')
  expect(process.env.BAMBOO_API_KEY).toBeUndefined()
})
