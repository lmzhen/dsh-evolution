// @tier pre-tag
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS } from '@deepseek-ai/dsh-evolution-core'
import { resolveMergeParams } from '../../src/params.ts'
import { limitsSnapshotOf } from '../../src/domain/merge-limits.ts'
import { buildValidationPlan } from '../../src/domain/validation-plan.ts'

it('params limitsSnapshot has the same canonical source as the limits helper', () => {
  const params = resolveMergeParams()
  expect(params.limitsSnapshot?.limitsDigest).toBe(limitsSnapshotOf(DEFAULT_SKILL_LIMITS).limitsDigest)
  expect(params.limitsSnapshot?.skillLimits).toEqual(DEFAULT_SKILL_LIMITS)
})

it('persists supportFiles/manifestFiles and validation provenance in the plan', () => {
  const plan = buildValidationPlan({
    tree: { target: 't', body: 'references/a.md', files: [{ path: 'references/a.md', content: 'a' }] },
    target: 't', limits: limitsSnapshotOf(DEFAULT_SKILL_LIMITS),
    supportFiles: [{ path: 'references/a.md', content: 'a', source: 'alpha' }],
    manifestFiles: ['references/a.md'],
  })
  expect(plan.planVersion).toBe(1)
  expect(plan.stageDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(plan.supportFiles).toEqual([{ path: 'references/a.md', digest: expect.any(String), source: 'alpha' }])
  expect(plan.manifestFiles).toEqual(['references/a.md'])
})
