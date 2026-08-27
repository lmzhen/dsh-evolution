import { expect, it } from 'vitest'
import { PROMPT_BUNDLE, PROMPT_BUNDLE_VERSION, verifyPromptBundle } from '@deepseek-ai/dsh-evolution-core'

it('verifyPromptBundle accepts the canonical bundle', () => {
  expect(verifyPromptBundle(PROMPT_BUNDLE)).toBe(true)
})

it('verifyPromptBundle rejects a bundle that drifted off the pinned id/version', () => {
  const drifted = { ...PROMPT_BUNDLE, id: 'dsh-evolution@999' }
  expect(verifyPromptBundle(drifted)).toBe(false)
  const driftedVersion = { ...PROMPT_BUNDLE, version: PROMPT_BUNDLE_VERSION + 1 }
  expect(verifyPromptBundle(driftedVersion)).toBe(false)
})

it('verifyPromptBundle rejects tampered prompt content', () => {
  const tampered = {
    ...PROMPT_BUNDLE,
    prompts: { ...PROMPT_BUNDLE.prompts, skill: (PROMPT_BUNDLE.prompts['skill'] ?? '') + '\n# injected' },
  }
  expect(verifyPromptBundle(tampered)).toBe(false)
})
