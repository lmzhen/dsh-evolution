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
})
