import { describe, expect, it } from 'vitest'
import type { MemoryOp } from '../src/index.ts'
import { validateEvolutionPlan } from '../src/index.ts'

describe('evolution-plan-validator', () => {
  it('rejects ops without evidence and protected skills', () => {
    const result = validateEvolutionPlan({
      memoryOps: [{ action: 'add', target: 'memory', facts: 'user likes tea', evidence: [{ event_seq: 4 }] }],
      skillOps: [{ action: 'patch', name: 'plan', old_string: 'x', new_string: 'y', evidence: [] }],
    }, { sessionSeq: 10, protectedSkillNames: new Set(['plan']) })
    expect(result.ok).toBe(false)
    expect(result.accepted.memoryOps).toHaveLength(1)
    expect(result.rejected.some(r => r.kind === 'skill' && r.reason.includes('protected'))).toBe(true)
  })

  it('rejects forbidden policy fields and invalid evidence', () => {
    const result = validateEvolutionPlan({
      memoryOps: [{ action: 'add', target: 'memory', facts: 'x', evidence: [{ event_seq: 999 }] } satisfies MemoryOp],
    }, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected[0]?.reason).toMatch(/forbidden|evidence/)
  })

  it('rejects a background delete without absorbed_into (Hermes fail-closed guard)', () => {
    const result = validateEvolutionPlan({
      skillOps: [{ action: 'delete', name: 'narrow-skill', evidence: [{ event_seq: 4 }] }],
    }, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected.some(r => r.kind === 'skill' && r.reason.includes('absorbed_into'))).toBe(true)
    // With an absorbed_into target the delete is accepted.
    const accepted = validateEvolutionPlan({
      skillOps: [{ action: 'delete', name: 'narrow-skill', absorbed_into: 'umbrella', evidence: [{ event_seq: 4 }] }],
    }, { sessionSeq: 10 })
    expect(accepted.ok).toBe(true)
  })

  it('validates restructure moves: shape, domain and move cap (008 batch B)', () => {
    const base = { action: 'restructure', name: 'fat-skill', evidence: [{ event_seq: 4 }] } as const
    const ok = validateEvolutionPlan({
      skillOps: [{ ...base, restructure: [{ heading: 'Details log', to_file: 'references/log.md' }] }],
    }, { sessionSeq: 10 })
    expect(ok.ok).toBe(true)
    const missing = validateEvolutionPlan({ skillOps: [{ ...base }] }, { sessionSeq: 10 })
    expect(missing.ok).toBe(false)
    expect(missing.rejected[0]?.reason).toContain('non-empty restructure list')
    const badFile = validateEvolutionPlan({
      skillOps: [{ ...base, restructure: [{ heading: 'Details log', to_file: 'templates/x.md' }] }],
    }, { sessionSeq: 10 })
    expect(badFile.rejected[0]?.reason).toContain('references/<topic>.md')
    const badHeading = validateEvolutionPlan({
      skillOps: [{ ...base, restructure: [{ heading: '', to_file: 'references/x.md' }] }],
    }, { sessionSeq: 10 })
    expect(badHeading.rejected[0]?.reason).toContain('non-empty heading')
    const tooMany = validateEvolutionPlan({
      skillOps: [{ ...base, restructure: Array.from({ length: 6 }, (_, i) => ({ heading: `h${i}`, to_file: `references/${i}.md` })) }],
    }, { sessionSeq: 10 })
    expect(tooMany.rejected[0]?.reason).toContain('exceeds')
  })
})
