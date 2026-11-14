// @tier ci-only
import { expect, it } from 'vitest'
import { DOMAIN_GENERATION_PROMPT, buildDomainGenerationPrompt } from '../src/index.ts'

it('parameterizes the domain count without changing the default', () => {
  expect(buildDomainGenerationPrompt()).toContain('8–12')
  expect(buildDomainGenerationPrompt({ minDomains: 5, maxDomains: 7 })).toContain('5–7')
  expect(buildDomainGenerationPrompt({ minDomains: 9, maxDomains: 3 })).toContain('8–12')
  expect(DOMAIN_GENERATION_PROMPT).toContain('8–12')
})
