import { describe, expect, it } from 'vitest'
import type { MemoryOp, SkillOp } from '../src/index.ts'
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

  it('rejects ops with invalid evidence', () => {
    const result = validateEvolutionPlan({
      memoryOps: [{ action: 'add', target: 'memory', facts: 'x', evidence: [{ event_seq: 999 }] } satisfies MemoryOp],
    }, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected[0]?.reason).toMatch(/evidence/)
  })

  it('rejects operations carrying forbidden control keys (F-361)', () => {
    // `policy`/`threshold` are FORBIDDEN_CONTROL_KEYS — the checker refuses any
    // op that smuggles a control-plane field through the model plan.
    const mem = validateEvolutionPlan({
      memoryOps: [{ action: 'add', target: 'memory', facts: 'x', evidence: [{ event_seq: 1 }], policy: 'x' }],
    } as never, { sessionSeq: 10 })
    expect(mem.ok).toBe(false)
    expect(mem.rejected[0]?.reason).toContain('forbidden field policy')
    const skill = validateEvolutionPlan({
      skillOps: [{ action: 'patch', name: 'a', old_string: 'x', new_string: 'y', evidence: [{ event_seq: 1 }], threshold: 1 }],
    } as never, { sessionSeq: 10 })
    expect(skill.ok).toBe(false)
    expect(skill.rejected[0]?.reason).toContain('forbidden field threshold')
  })

  it('rejects malformed ops per-item instead of throwing (E-60, 0.3.17)', () => {
    const result = validateEvolutionPlan({
      memoryOps: [null, 'x', { action: 'add', target: 'memory', facts: 'ok', evidence: [{ event_seq: 1 }] }],
      skillOps: [{ action: 'patch', name: 'a', evidence: [{ event_seq: 1 }] }, []],
    } as never, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected.filter(r => r.reason.includes('malformed'))).toHaveLength(3)
    expect(result.accepted.memoryOps).toHaveLength(1)
  })

  it('enforces the content budget on a patch new_string (E-27, 0.3.17)', () => {
    const giant = 'x'.repeat(100_001)
    const result = validateEvolutionPlan({
      skillOps: [{ action: 'patch', name: 'fat-skill', old_string: 'old', new_string: giant, evidence: [{ event_seq: 4 }] }],
    }, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected[0]?.reason).toContain('exceeds skill budget')
  })

  it('N-3: an empty content field must not shadow a giant new_string (0.3.20)', () => {
    const giant = 'x'.repeat(100_001)
    const result = validateEvolutionPlan({
      skillOps: [{ action: 'patch', name: 'fat-skill', old_string: 'old', content: '', new_string: giant, evidence: [{ event_seq: 4 }] }],
    }, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected[0]?.reason).toContain('exceeds skill budget')
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
    const base: SkillOp = { action: 'restructure', name: 'fat-skill', evidence: [{ event_seq: 4 }] }
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

  it('F-319: a non-array ops container with a length is rejected per-container, never thrown', () => {
    const result = validateEvolutionPlan({ memoryOps: { length: 2 } } as never, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected.some(r => r.kind === 'memory' && r.reason.includes('memoryOps: must be an array'))).toBe(true)
    expect(result.accepted.memoryOps).toEqual([])
    // A malformed skill container alongside valid memory ops: the valid memory
    // ops still get per-item treatment and the malformed container is rejected.
    const mixed = validateEvolutionPlan({
      memoryOps: [{ action: 'add', target: 'memory', facts: 'x', evidence: [{ event_seq: 1 }] }],
      skillOps: { length: 2 },
    } as never, { sessionSeq: 10 })
    expect(mixed.ok).toBe(false)
    expect(mixed.rejected.some(r => r.kind === 'skill' && r.reason.includes('skillOps: must be an array'))).toBe(true)
  })

  it('V4-23: a null/array/primitive plan root is rejected explicitly, never a TypeError', () => {
    for (const bad of [null, undefined, [], 'string', 0]) {
      const result = validateEvolutionPlan(bad as never, { sessionSeq: 10 })
      expect(result.ok, `root=${String(bad)}`).toBe(false)
      expect(result.rejected.some(r => r.kind === 'memory' && r.reason === 'plan root: must be an object')).toBe(true)
    }
    // A well-formed plan still validates after the guard.
    const ok = validateEvolutionPlan({ memoryOps: [{ action: 'add', target: 'memory', facts: 'x', evidence: [{ event_seq: 1 }] }] }, { sessionSeq: 10 })
    expect(ok.ok).toBe(true)
  })

  it('V6-26: a missing skill action is normalized to an explicit "patch" on the accepted op (0.3.37)', () => {
    const result = validateEvolutionPlan({
      memoryOps: [],
      skillOps: [{ name: 'demo', old_string: 'x', new_string: 'y', evidence: [{ event_seq: 1 }] }],
    }, { sessionSeq: 10 } satisfies Parameters<typeof validateEvolutionPlan>[1])
    expect(result.ok).toBe(true)
    expect(result.accepted.skillOps!).toHaveLength(1)
    expect(result.accepted.skillOps![0]?.action).toBe('patch')
  })

  it('V8-23⑪: a missing MEMORY action is normalized to an explicit "add" on the accepted op (V9-12)', () => {
    const result = validateEvolutionPlan({
      memoryOps: [{ target: 'memory', facts: 'x', evidence: [{ event_seq: 1 }] }],
      skillOps: [],
    }, { sessionSeq: 10 } satisfies Parameters<typeof validateEvolutionPlan>[1])
    expect(result.ok).toBe(true)
    expect(result.accepted.memoryOps!).toHaveLength(1)
    expect(result.accepted.memoryOps![0]?.action).toBe('add')
  })

  it('P2-1 (v15): a non-string truthy field is a per-op REJECTION, not a TypeError', () => {
    // The E-60 contract: the caller hands the validator MODEL OUTPUT — a
    // malformed FIELD must not throw (which failed the whole review round);
    // it rejects the single op like every other malformed shape.
    const result = validateEvolutionPlan({
      memoryOps: [{ action: 'add', target: 'memory', facts: { body: 'object facts' }, evidence: [{ event_seq: 1 }] } as unknown as MemoryOp],
      skillOps: [{ action: 'patch', name: 42, old_string: 'x', new_string: 'y', evidence: [{ event_seq: 1 }] } as unknown as MemoryOp],
    }, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.accepted.memoryOps).toHaveLength(0)
    expect(result.accepted.skillOps).toHaveLength(0)
    expect(result.rejected.some(r => r.reason.includes('facts must be a string'))).toBe(true)
    expect(result.rejected.some(r => r.reason.includes('name must be a string'))).toBe(true)
  })

  it('P2 (v16): file_path joins the field-type guard (executor-side TypeError class)', () => {
    const result = validateEvolutionPlan({
      memoryOps: [{ target: 'memory', facts: 'x', evidence: [{ event_seq: 1 }] }],
      skillOps: [{ action: 'write_file', name: 'demo', file_path: 42, file_content: 'body', evidence: [{ event_seq: 1 }] } as unknown as MemoryOp],
    }, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected.some(r => r.reason.includes('file_path must be a string'))).toBe(true)
  })

  it('P3 (v15): write_file is gated on file_content ONLY (executor parity)', () => {
    // The old `?? op.content` fallback admitted a write_file whose executor
    // write landed an EMPTY support file.
    const result = validateEvolutionPlan({
      memoryOps: [{ target: 'memory', facts: 'x', evidence: [{ event_seq: 1 }] }],
      skillOps: [{ action: 'write_file', name: 'demo', content: 'content only', evidence: [{ event_seq: 1 }] }],
    }, { sessionSeq: 10 })
    expect(result.ok).toBe(false)
    expect(result.rejected.some(r => r.reason.includes('write_file requires file_content'))).toBe(true)
  })
})
