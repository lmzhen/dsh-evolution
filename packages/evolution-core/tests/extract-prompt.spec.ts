// @tier fast
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { EXTRACT_PROMPT_V1, EXTRACT_PROMPT_VERSION } from '@deepseek-ai/dsh-evolution-core'

it('keeps the frozen extract prompt byte-stable', () => {
  expect(EXTRACT_PROMPT_VERSION).toBe('v1')
  expect(createHash('sha256').update(EXTRACT_PROMPT_V1).digest('hex')).toBe('ec691d3e3d36c519e8a9634a20ef0b5c23d033f7942b2539ae451abe13a9feac')
  expect(EXTRACT_PROMPT_V1).toContain('no split is required')
  expect(EXTRACT_PROMPT_V1).not.toContain('review')
})
