/** G2 adapter: core UnitBackend over the existing SkillLibrary. */
import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import { SystemSkillWriter, skillBodyTarget, skillSupportTarget, type SkillLibrary, type SkillWritePlan } from '@deepseek-ai/dsh-evolution-core/skills'
import type { UnitBackend, UnitCommitResult, UnitPlan } from './unit-protocol.ts'

const SYSTEM_ORIGIN = 'background_review' as const

function expectedOf(current: string | null): { kind: 'absent' } | { kind: 'present'; version: string } {
  return current === null ? { kind: 'absent' } : { kind: 'present', version: contentHash(current) }
}

function bodyPlan(name: string, content: string, current: string | null): SkillWritePlan {
  return { origin: SYSTEM_ORIGIN, ops: [{ kind: 'write', target: skillBodyTarget(name), content, expect: expectedOf(current) }] }
}

function supportPlan(name: string, path: string, content: string | null, current: string | null): SkillWritePlan {
  const target = skillSupportTarget(name, path)
  return content === null
    ? { origin: SYSTEM_ORIGIN, ops: [{ kind: 'remove', target, expect: { kind: 'present', version: contentHash(current ?? '') } }] }
    : { origin: SYSTEM_ORIGIN, ops: [{ kind: 'write', target, content, expect: expectedOf(current) }] }
}


export function skillLibraryUnitBackend(skills: SkillLibrary): UnitBackend {
  const writer = new SystemSkillWriter(skills)
  return {
    async readSkill(name) { return await skills.read(name) },
    async readSupportFile(name, path) {
      const probe = (skills as unknown as { readSupportFile?: (name: string, path: string) => Promise<string | null> }).readSupportFile
      return typeof probe === 'function' ? await probe.call(skills, name, path) : null
    },
    async commit(plan: UnitPlan, onPhase, signal, assertFence, options): Promise<UnitCommitResult> {
      const result = await skills.commitMerge({
        ...(plan.runId === undefined ? {} : { runId: plan.runId }),
        ...(plan.unitId === undefined ? {} : { unitId: plan.unitId }),
        target: plan.target,
        nested: true,
        targetExists: plan.targetExists,
        sources: plan.sources,
        body: plan.body,
        supportFiles: plan.supportFiles,
        expectedTargetBody: plan.expectedTargetBody,
        expectedSourceBodies: plan.expectedSourceBodies,
        origin: plan.origin,
        summary: plan.summary,
        ...(plan.skillLimits === undefined ? {} : { limits: plan.skillLimits }),
        ...(plan.targetRevision === undefined ? {} : { targetRevision: plan.targetRevision }),
        ...(plan.sourceRevisions === undefined ? {} : { sourceRevisions: plan.sourceRevisions }),
        ...(plan.supportDigest === undefined ? {} : { supportDigest: plan.supportDigest }),
        ...(onPhase === undefined ? {} : { onPhase }),
        ...(signal === undefined ? {} : { signal }),
        ...(assertFence === undefined ? {} : { assertFence }),
      }, { ...(options?.serialized === undefined ? {} : { serialized: options.serialized }) })
      return { ok: result.ok, message: result.message, ...(result.code === undefined ? {} : { code: result.code }), ...(result.archived === undefined ? {} : { archived: result.archived }), ...(result.mutations === undefined ? {} : { mutations: result.mutations }) }
    },
    async restoreTarget(name, body) {
      if (body === null) { await skills.archive(name, { reason: 'unit-rollback' }); return }
      const result = await writer.apply(bodyPlan(name, body, await skills.read(name)))
      if (!result.ok) throw new Error(result.message)
    },
    async restoreSupportFile(name, path, content) {
      const current = await skills.readSupportFile(name, path)
      const result = await writer.apply(supportPlan(name, path, content, current))
      if (!result.ok) throw new Error(result.message)
    },
    async restoreSource(name, body) {
      const restored = await skills.restoreFromArchive(name)
      if (restored.ok) return
      const current = await skills.read(name)
      const result = await writer.apply(bodyPlan(name, body, current))
      if (!result.ok) throw new Error(result.message)
    },
  }
}
