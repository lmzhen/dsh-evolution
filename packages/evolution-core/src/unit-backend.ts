/** G2 adapter: core UnitBackend over the existing SkillLibrary. */
import type { SkillLibrary } from './skill-store.ts'
import type { UnitBackend, UnitCommitResult, UnitPlan } from './unit-transaction.ts'

export function skillLibraryUnitBackend(skills: SkillLibrary): UnitBackend {
  return {
    async readSkill(name) { return await skills.read(name) },
    async readSupportFile(name, path) {
      const probe = (skills as unknown as { readSupportFile?: (name: string, path: string) => Promise<string | null> }).readSupportFile
      return typeof probe === 'function' ? await probe.call(skills, name, path) : null
    },
    async commit(plan: UnitPlan, onPhase, signal, assertFence): Promise<UnitCommitResult> {
      const result = await skills.commitMerge({
        target: plan.target,
        targetExists: plan.targetExists,
        sources: plan.sources,
        body: plan.body,
        supportFiles: plan.supportFiles,
        expectedTargetBody: plan.expectedTargetBody,
        expectedSourceBodies: plan.expectedSourceBodies,
        origin: plan.origin,
        summary: plan.summary,
        ...(onPhase === undefined ? {} : { onPhase }),
        ...(signal === undefined ? {} : { signal }),
        ...(assertFence === undefined ? {} : { assertFence }),
      })
      return { ok: result.ok, message: result.message, ...(result.archived === undefined ? {} : { archived: result.archived }), ...(result.mutations === undefined ? {} : { mutations: result.mutations }) }
    },
    async restoreTarget(name, body) {
      if (body === null) { await skills.archive(name, { reason: 'unit-rollback' }); return }
      const result = await skills.update(name, body)
      if (!result.ok) throw new Error(result.message)
    },
    async restoreSupportFile(name, path, content) {
      const result = content === null ? await skills.removeSupportFile(name, path) : await skills.writeSupportFile(name, path, content)
      if (!result.ok) throw new Error(result.message)
    },
    async restoreSource(name, body) {
      const restored = await skills.restoreFromArchive(name)
      if (restored.ok) return
      const result = await skills.update(name, body)
      if (!result.ok) throw new Error(result.message)
    },
  }
}
