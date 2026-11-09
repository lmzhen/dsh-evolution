import type { UnitTransaction } from '../../src/unit-protocol.ts'
import type { CommitPort, CommitMergeResult } from '../../src/commit-execute.ts'

/** Test-only adapter for fixtures that still model a CommitPort. Production has no fallback. */
export function legacyUnit(port: CommitPort, runId = 'run-1'): UnitTransaction {
  let evidence: any
  let plan: any
  const unitId = 'legacy:test'
  return {
    async prepare(input) { plan = input; return { ok: true as const, prepared: { unitId, planDigest: unitId } } },
    async commit() {
      if (port.commitMerge === undefined) return { ok: false as const, code: 'unit-commit-failed' as const, message: 'commitMerge missing' }
      const result: CommitMergeResult = await port.commitMerge(plan)
      if (!result.ok) return { ok: false as const, code: result.code ?? 'unit-commit-failed' as const, message: result.message }
      const actual = result.unitId ?? unitId
      evidence = {
        schemaVersion: 1, unitId: actual, runId, planDigest: actual, state: 'complete',
        target: { before: plan.expectedTargetBody, after: plan.body, supportDigest: '', created: !plan.targetExists },
        sources: plan.sources.filter((name: string) => name !== plan.target).map((name: string) => ({ name, before: plan.expectedSourceBodies.find((item: { name: string }) => item.name === name)?.body ?? '', after: null, archived: (result.archived ?? []).includes(name), absorbedInto: plan.target })),
        mutations: result.mutations ?? 0, at: 1,
      }
      return { ok: true as const, evidence }
    },
    async verify() { return evidence ?? null },
    async rollback() { return { ok: false as const, code: 'unit-committed' as const, message: 'legacy test unit cannot roll back' } },
    async finalize() { return evidence === undefined ? { ok: false as const, code: 'unit-plan-missing' as const, message: 'no evidence' } : { ok: true as const, evidence } },
    async rollForward() { return evidence === undefined ? { ok: false as const, code: 'unit-plan-missing' as const, message: 'no evidence' } : { ok: true as const, evidence } },
    async cancel() { return { ok: false, phase: 'none' as const } },
  }
}
