import { describe, expect, it } from 'vitest'
import { DomainPolicyValidationError, domainGenerationMode, mergeDomainPolicy, validateDomainGeneration, type GeneratedDomain, type GenerationSkillFact } from '../src/index.ts'

function facts(count: number): GenerationSkillFact[] {
  return Array.from({ length: count }, (_, index) => ({ name: 'skill-' + index, description: 'description ' + index, whenToUse: 'when ' + index }))
}
function domain(index: number): GeneratedDomain {
  return { title: 'domain-' + index, purpose: 'purpose ' + index, inScope: ['in'], outOfScope: ['out'], triggers: ['trigger'], evidenceSkillKeys: ['skill-' + index] }
}
function proposal(count = 8) { return { domains: Array.from({ length: count }, (_, index) => domain(index)) } }

describe('domain policy', () => {
  it('merges mode/disable/pin with disable precedence and degraded unknown ids', () => {
    const known = new Set(['a', 'b', 'c', 'd'])
    const policy = mergeDomainPolicy(
      { mode: 'auto', disableDomains: ['a'], pinDomains: ['b'], revision: 'g' },
      { mode: 'on', disableDomains: ['c'], pinDomains: ['a'], revision: 'w' },
      { disableDomains: ['b'], pinDomains: ['d'] },
      known,
    )
    expect(policy.mode).toBe('on')
    expect([...policy.disabled].sort()).toEqual(['a', 'b', 'c'])
    expect([...policy.pinned]).toEqual(['d'])
    expect(policy.degraded).toEqual([])
    expect(mergeDomainPolicy({}, undefined, undefined, known).mode).toBe('off')
    expect(mergeDomainPolicy({ pinDomains: ['zzz'] }, undefined, undefined, known).degraded).toEqual(['zzz'])
  })

  it('rejects taxonomy edits in a policy layer', () => {
    expect(() => mergeDomainPolicy({ skills: [] } as never)).toThrow(DomainPolicyValidationError)
  })
})

describe('domain generation contract', () => {
  it('mints 8-12 domains and validates evidence/forbidden fields', () => {
    const input = { skills: facts(8) }
    const valid = validateDomainGeneration(input, proposal(8))
    expect(valid.ok).toBe(true)
    if (!valid.ok) return
    expect(valid.domains[0]?.id).toMatch(/^domain-[a-f0-9]{12}$/)
    expect(validateDomainGeneration(input, proposal(7)).ok).toBe(false)
    expect(validateDomainGeneration(input, proposal(13)).ok).toBe(false)
    const unknown = proposal(8); unknown.domains[0] = { ...domain(0), evidenceSkillKeys: ['missing'] }
    expect(validateDomainGeneration(input, unknown).ok).toBe(false)
    const primaryParent = { ...proposal(8), domains: [{ ...domain(0), primaryParent: 'x' }, ...proposal(8).domains.slice(1)] }
    expect(validateDomainGeneration(input, primaryParent).ok).toBe(false)
    const embedding = { ...proposal(8), embedding: [1, 2, 3] }
    expect(validateDomainGeneration(input, embedding).ok).toBe(false)
  })

  it('uses direct generation through 100 skills and prechunk above 100', () => {
    expect(domainGenerationMode(40)).toBe('direct')
    expect(domainGenerationMode(100)).toBe('direct')
    expect(domainGenerationMode(101)).toBe('prechunk-eligible')
    expect(() => domainGenerationMode(-1)).toThrow(RangeError)
  })
})
