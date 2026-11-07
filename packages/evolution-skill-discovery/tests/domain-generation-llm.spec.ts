// @tier ci-only
import { describe, expect, it } from 'vitest'
import { DomainGenerationError, LlmDomainGenerationPort, parseDomainGenerationProposal } from '../src/domain-generation-llm.ts'

const skills = Array.from({ length: 8 }, (_, index) => ({ name: 'skill-' + index, description: 'desc ' + index }))
const proposal = {
  domains: skills.map((skill, index) => ({
    title: 'domain-' + index,
    purpose: 'purpose ' + index,
    inScope: ['in'],
    outOfScope: ['out'],
    triggers: ['trigger'],
    evidenceSkillKeys: [skill.name],
  })),
}

describe('parseDomainGenerationProposal', () => {
  it('accepts JSON and fenced JSON with 8 domains', () => {
    expect(parseDomainGenerationProposal(JSON.stringify(proposal), skills).domains).toHaveLength(8)
    expect(parseDomainGenerationProposal('\u0060\u0060\u0060json\n' + JSON.stringify(proposal) + '\n\u0060\u0060\u0060', skills).domains).toHaveLength(8)
  })

  it('rejects empty, non-JSON, and invalid proposals', () => {
    expect(() => parseDomainGenerationProposal('', skills)).toThrow(DomainGenerationError)
    expect(() => parseDomainGenerationProposal('not json', skills)).toThrow(/non-JSON/)
    expect(() => parseDomainGenerationProposal(JSON.stringify({ domains: [] }), skills)).toThrow(/invalid domain proposal/)
    expect(() => parseDomainGenerationProposal(JSON.stringify({ domains: Array.from({ length: 8 }, () => ({ purpose: 'p' })) }), skills)).toThrow(DomainGenerationError)
  })
})

describe('LlmDomainGenerationPort', () => {
  it('wraps transport failures as typed llm-unavailable', async () => {
    const port = new LlmDomainGenerationPort({
      available: () => true,
      text: async () => { throw new Error('provider down') },
    }, { provider: 'p', model: 'm' })
    await expect(port.generate({ skills, prompt: 'p' })).rejects.toMatchObject({ code: 'llm-unavailable' })
  })
})

it('retries once with validation feedback', async () => {
  let calls = 0
  const port = new LlmDomainGenerationPort({
    available: () => true,
    text: async () => {
      calls += 1
      return calls === 1 ? 'not json' : JSON.stringify(proposal)
    },
  }, { provider: 'p', model: 'm', attempts: 2 })
  const result = await port.generate({ skills, prompt: 'p' })
  expect(result.domains).toHaveLength(8)
  expect(calls).toBe(2)
})

it('sends the live skill list to the model', async () => {
  let prompt = ''
  const port = new LlmDomainGenerationPort({
    available: () => true,
    text: async (input) => {
      prompt = input.messages.map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('')).join('')
      return JSON.stringify(proposal)
    },
  }, { provider: 'p', model: 'm', attempts: 1 })
  await port.generate({ skills, prompt: 'base' })
  expect(prompt).toContain('skill-0: desc 0')
  expect(prompt).toContain('copy evidenceSkillKeys')
})
