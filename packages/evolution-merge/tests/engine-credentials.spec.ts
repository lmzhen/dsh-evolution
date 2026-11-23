// @tier pre-tag
import { afterEach, expect, it } from 'vitest'
import { clearRetrievalCredentials, screen } from '@deepseek-ai/dsh-evolution-merge-engine'

const ENV_KEYS = ['SILICONFLOW_API_KEY', 'BAMBOO_API_KEY'] as const
const previous = new Map<string, string | undefined>()

afterEach(() => {
  clearRetrievalCredentials()
  for (const key of ENV_KEYS) {
    const value = previous.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
    previous.delete(key)
  }
})

it('projects resolved UI keys into the frozen engine env interface and clears them again', async () => {
  for (const key of ENV_KEYS) previous.set(key, process.env[key])
  delete process.env.SILICONFLOW_API_KEY
  delete process.env.BAMBOO_API_KEY

  const result = await screen({ corpusDir: '', outDir: '', credentials: { embedding: 'sf-ui', ranker: 'bamboo-ui' } })
  expect(result.ok).toBe(false)
  expect(process.env.SILICONFLOW_API_KEY).toBe('sf-ui')
  expect(process.env.BAMBOO_API_KEY).toBe('bamboo-ui')

  clearRetrievalCredentials()
  expect(process.env.SILICONFLOW_API_KEY).toBeUndefined()
  expect(process.env.BAMBOO_API_KEY).toBeUndefined()
})

it('restores an ambient env value rather than leaking the UI value', async () => {
  for (const key of ENV_KEYS) previous.set(key, process.env[key])
  process.env.SILICONFLOW_API_KEY = 'ambient-sf'
  delete process.env.BAMBOO_API_KEY

  await screen({ corpusDir: '', outDir: '', credentials: { embedding: 'sf-ui' } })
  expect(process.env.SILICONFLOW_API_KEY).toBe('sf-ui')

  clearRetrievalCredentials()
  expect(process.env.SILICONFLOW_API_KEY).toBe('ambient-sf')
  expect(process.env.BAMBOO_API_KEY).toBeUndefined()
})
