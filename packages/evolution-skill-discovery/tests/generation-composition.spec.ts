// @tier ci-only
import { expect, it } from 'vitest'
import { buildGenerationRequest, resolveGenerationPort } from '../src/generation-composition.ts'
import { DomainGenerationError } from '../src/domain-generation-llm.ts'
import { skillIndexRowOf } from '../src/identity.ts'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'

const summary: SkillSummary = { name: 'alpha', description: 'alpha desc', whenToUse: 'use alpha', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'dsh-evolution' }

it('fails loud when mode:on has no llm service', () => {
  expect(() => resolveGenerationPort({ mode: 'on', provider: 'p', model: 'm' })).toThrow(DomainGenerationError)
  expect(resolveGenerationPort({ mode: 'off', provider: 'p', model: 'm' })).toBeUndefined()
})

it('builds a global-map request from live rows', () => {
  const request = buildGenerationRequest({ mapScope: 'global', sourceDigest: 'src', mapVersion: '0', rows: [skillIndexRowOf(summary, true)], prompt: 'p', promptVersion: 'v2' })
  expect(request.mapScope).toBe('global')
  expect(request.sourceDigest).toBe('src')
  expect(request.expectedMapVersion).toBe('0')
  expect(request.facts[0]).toMatchObject({ name: 'alpha', whenToUse: 'use alpha' })
})
