// @tier ci-only
import { expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { DOMAIN_GENERATION_PROMPT, buildDomainGenerationPrompt, DomainMapFileStore, initialDomainMap, type DomainGenerationProposal } from '../src/index.ts'

class Io implements EvolutionIoLike {
  files = new Map<string, string>()
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [...this.files.keys()] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) { this.files.set(to, value); this.files.delete(from) } }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value !== undefined) this.files.set(to, value) }
}
function proposal(): DomainGenerationProposal { return { domains: Array.from({ length: 8 }, (_, index) => ({ title: 'domain-' + index, purpose: 'purpose ' + index, inScope: ['in'], outOfScope: ['out'], triggers: ['t' + index], evidenceSkillKeys: ['skill-' + index] })) } }
it('runs the LLM port once only for an empty map', async () => {
  const store = new DomainMapFileStore(new Io(), 'map.json', () => 1)
  let calls = 0
  let seenPrompt = ''
  const port = { async generate(input: { prompt: string }) { calls += 1; seenPrompt = input.prompt; return proposal() } }
  const facts = Array.from({ length: 8 }, (_, index) => ({ name: 'skill-' + index, description: 'description ' + index, whenToUse: 'when ' + index }))
  const keys = Object.fromEntries(facts.map((fact, index) => [fact.name, 'key-' + index]))
  const first = await initialDomainMap(store, port, facts, keys, '0')
  expect(first.domains).toHaveLength(8)
  const second = await initialDomainMap(store, port, facts, keys, '1')
  expect(second.domains).toHaveLength(8)
  expect(calls).toBe(1)
  expect(seenPrompt).toBe(DOMAIN_GENERATION_PROMPT)
  expect(DOMAIN_GENERATION_PROMPT).toContain('8–12')
})


it('parameterizes the domain count without changing the default', () => {
  expect(buildDomainGenerationPrompt()).toContain('8–12')
  expect(buildDomainGenerationPrompt({ minDomains: 5, maxDomains: 7 })).toContain('5–7')
  expect(buildDomainGenerationPrompt({ minDomains: 9, maxDomains: 3 })).toContain('8–12')
})
