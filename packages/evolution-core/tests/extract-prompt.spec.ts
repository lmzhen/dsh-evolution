// @tier fast
import { expect, it } from 'vitest'
import { EXTRACT_PROMPT_V1, EXTRACT_PROMPT_VERSION } from '@deepseek-ai/dsh-evolution-core'

it('exposes a versioned extract prompt without pinning its prose', () => {
  expect(EXTRACT_PROMPT_VERSION).toBe('v1')
  expect(EXTRACT_PROMPT_V1.trim().length).toBeGreaterThan(100)
})
