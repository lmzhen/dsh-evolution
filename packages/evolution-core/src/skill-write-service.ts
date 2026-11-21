/**
 * The first service layer over skill observations and the CAS primitive.
 *
 * It is intentionally narrow while Phase C moves behavior off the tool:
 * read records an observation for one owner; update/patch derive their expected
 * version from that observation and execute through the library mutators with a
 * content anchor, so validation/audit/history stay in their existing owner.
 * existing create/update/patch paths keep their behavior.
 *
 * @module @deepseek-ai/dsh-evolution-core/skill-write-service
 */
import { contentHash } from './mutations.ts'
import type { SkillLibrary, SkillSectionEdit, WriteAnchor, WriteOrigin } from './skill-store.ts'
import type { SkillObservationStore, SkillTarget } from './skill-observation.ts'
import { skillBodyTarget, skillSupportTarget } from './skill-observation.ts'
import type { SkillWritePlan } from './skill-write-plan.ts'

/** Exact execution identity for observations. */
export type SkillWriteOwner = object

/** Stable failure codes for the future model-facing error map. */
export type SkillWriteErrorCode =
  | 'SKILL_NOT_OBSERVED'
  | 'SKILL_STALE_VERSION'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_ALREADY_EXISTS'
  | 'SKILL_AMBIGUOUS_EDIT'
  | 'SKILL_EDIT_NOT_FOUND'
  | 'SKILL_INVALID'

/** Result of one service operation. */
export type SkillWriteServiceResult =
  | { readonly ok: true; readonly message: string; readonly noop?: boolean; readonly content?: string | null; readonly path?: string; readonly normalizedFrontmatterFields?: readonly string[] }
  | { readonly ok: false; readonly code: SkillWriteErrorCode; readonly message: string }

/** Result of planning one write action. */
export type SkillWritePlanResult =
  | { readonly ok: true; readonly plan: SkillWritePlan }
  | { readonly ok: false; readonly code: SkillWriteErrorCode; readonly message: string }

/**
 * Read body/support bytes and record the observation for the exact owner.
 *
 * A read failure is a failed read, not an observation; `null` means the file is
 * authoritatively absent and is recorded as such.
 */
export class SkillWriteService {
  constructor(
    private readonly library: SkillLibrary,
    private readonly observations: SkillObservationStore,
  ) {}

  /**
   * Read SKILL.md and record present/absent for this owner.
   * @param owner - exact session/review/run identity.
   * @param name - skill name.
   * @returns the body, or null when absent.
   */
  async readBody(owner: SkillWriteOwner, name: string): Promise<string | null> {
    const target = await this.library.identify(skillBodyTarget(name))
    const content = await this.library.read(name)
    this.record(owner, target, content)
    return content
  }

  /**
   * Read one support file and record present/absent for this owner.
   * @param owner - exact session/review/run identity.
   * @param name - skill name.
   * @param filePath - support path.
   * @returns the bytes, or null when absent.
   */
  async readSupport(owner: SkillWriteOwner, name: string, filePath: string): Promise<string | null> {
    const target = await this.library.identify(skillSupportTarget(name, filePath))
    const content = await this.library.readSupportFile(name, filePath)
    this.record(owner, target, content)
    return content
  }

  /**
   * Plan a create. Creation is createIfAbsent by definition and needs no prior
   * read; the provider's `create` path keeps managed/protection semantics.
   * @param owner - writer identity (unused for create, kept for a uniform API).
   * @param name - skill name.
   * @param content - full body.
   * @param managed - add the managed marker (non-foreground origin).
   * @returns the plan or a typed refusal.
   */
  async planCreate(owner: SkillWriteOwner, name: string, content: string, origin: WriteOrigin = 'foreground', managed = false): Promise<SkillWritePlanResult> {
    void owner
    return {
      ok: true,
      plan: {
        origin,
        ops: [{ kind: 'createSkill', skill: name, content, ...(managed ? { managed: true } : {}) }],
      },
    }
  }

  /**
   * Plan a full body replacement from this owner's observation.
   * @param owner - exact writer.
   * @param name - skill name.
   * @param content - next body.
   * @param origin - write face.
   * @returns the plan or a typed refusal.
   */
  async planUpdate(owner: SkillWriteOwner, name: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillWritePlanResult> {
    const target = await this.library.identify(skillBodyTarget(name))
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return planRefusal(observed.kind)
    return {
      ok: true,
      plan: {
        origin,
        ops: [{ kind: 'write', target, content, expect: { kind: 'present', version: observed.version } }],
      },
    }
  }

  /**
   * Plan a literal patch against a body or support target.
   *
   * A section patch always targets the body and ignores `filePath`; that is the
   * same contract the library has always had, but now it is explicit in the
   * plan instead of a tool branch.
   * @param owner - exact writer.
   * @param name - skill name.
   * @param input - literal edit or section edit.
   * @param origin - write face.
   * @returns the plan or a typed refusal.
   */
  async planPatch(
    owner: SkillWriteOwner,
    name: string,
    input: {
      readonly oldString?: string
      readonly newString?: string
      readonly replaceAll?: boolean
      readonly filePath?: string
      readonly section?: SkillSectionEdit
    },
    origin: WriteOrigin = 'foreground',
  ): Promise<SkillWritePlanResult> {
    if (input.section !== undefined) {
      const target = await this.library.identify(skillBodyTarget(name))
      const observed = this.observations.requirePresent(owner, target)
      if (!('version' in observed)) return planRefusal(observed.kind)
      return {
        ok: true,
        plan: {
          origin,
          ops: [{
            kind: 'patchSection',
            target,
            section: input.section,
            expect: { kind: 'present', version: observed.version },
          }],
        },
      }
    }
    const filePath = input.filePath ?? ''
    const logicalTarget = filePath === '' ? skillBodyTarget(name) : skillSupportTarget(name, filePath)
    const target = await this.library.identify(logicalTarget)
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return planRefusal(observed.kind)
    return {
      ok: true,
      plan: {
        origin,
        ops: [{
          kind: 'patch',
          target,
          oldString: input.oldString ?? '',
          newString: input.newString ?? '',
          replaceAll: input.replaceAll === true,
          expect: { kind: 'present', version: observed.version },
        }],
      },
    }
  }

  /**
   * Plan a full support-file write. A newly observed/absent file is
   * createIfAbsent; an already observed file is replaceIfVersion. An unread
   * existing file is refused instead of overwritten.
   * @param owner - exact writer.
   * @param name - skill name.
   * @param filePath - support path.
   * @param content - next bytes.
   * @param origin - write face.
   * @returns the plan or a typed refusal.
   */
  async planWriteSupport(
    owner: SkillWriteOwner,
    name: string,
    filePath: string,
    content: string,
    origin: WriteOrigin = 'foreground',
  ): Promise<SkillWritePlanResult> {
    const target = await this.library.identify(skillSupportTarget(name, filePath))
    const observed = this.observations.get(owner, target)
    if (observed === undefined) {
      // This read decides absent vs existing; it is not recorded as a read
      // observation. The real createIfAbsent guard is the kernel anchor.
      const current = await this.library.readSupportFile(name, filePath)
      if (current !== null) return notObserved()
      return { ok: true, plan: { origin, ops: [{ kind: 'write', target, content, expect: { kind: 'absent' } }] } }
    }
    if (observed.kind === 'absent') {
      return { ok: true, plan: { origin, ops: [{ kind: 'write', target, content, expect: { kind: 'absent' } }] } }
    }
    return {
      ok: true,
      plan: {
        origin,
        ops: [{ kind: 'write', target, content, expect: { kind: 'present', version: observed.version } }],
      },
    }
  }

  /**
   * Plan removing one support file from this owner's observation.
   * @param owner - exact writer.
   * @param name - skill name.
   * @param filePath - support path.
   * @param origin - write face.
   * @returns the plan or a typed refusal.
   */
  async planRemoveSupport(owner: SkillWriteOwner, name: string, filePath: string, origin: WriteOrigin = 'foreground'): Promise<SkillWritePlanResult> {
    const target = await this.library.identify(skillSupportTarget(name, filePath))
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return planRefusal(observed.kind)
    return {
      ok: true,
      plan: {
        origin,
        ops: [{ kind: 'remove', target, expect: { kind: 'present', version: observed.version } }],
      },
    }
  }

  /**
   * Apply one plan through the provider and record the committed result for
   * this owner. The re-read is temporary H2 bookkeeping; H5 replaces it with
   * the provider's `SkillWriteOutcome`, so a post-commit read failure can never
   * turn a landed write into a tool failure.
   * @param plan - the write plan.
   * @param owner - exact writer identity; omitted by internal callers that do
   * not own observations.
   * @returns the service-level result.
   */
  async apply(plan: SkillWritePlan, owner?: SkillWriteOwner): Promise<SkillWriteServiceResult> {
    const result = await this.library.apply(plan)
    if (result.ok && owner !== undefined) {
      try {
        await this.observeOutcomes(result, owner)
      } catch {
        // The write is already committed; an observation-cache failure must not
        // turn a landed write into a tool failure (K6).
      }
    }
    return actionResult(result)
  }

  private async observeOutcomes(result: { readonly outcomes: readonly { readonly target: SkillTarget; readonly version?: string }[] }, owner: SkillWriteOwner): Promise<void> {
    for (const outcome of result.outcomes) {
      if (outcome.version === undefined) continue
      const target = outcome.target.identityKey === undefined ? await this.library.identify(outcome.target) : outcome.target
      this.observations.record(owner, target, outcome.version === '' ? { kind: 'absent' } : { kind: 'present', version: outcome.version })
    }
  }

  /**
   * Replace SKILL.md only when this owner observed its current version.
   * @param owner - exact writer identity.
   * @param name - skill name.
   * @param content - full next body.
   * @returns write outcome or a typed refusal.
   */
  async updateBody(owner: SkillWriteOwner, name: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillWriteServiceResult> {
    const target = await this.library.identify(skillBodyTarget(name))
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return refusal(observed.kind)
    const result = await this.library.update(name, content, origin, anchorOf(observed.version))
    if (result.ok) await this.readBody(owner, name)
    return actionResult(result)
  }

  /**
   * Patch SKILL.md only when this owner observed its current version.
   * @param owner - exact writer identity.
   * @param name - skill name.
   * @param oldString - literal to replace.
   * @param newString - replacement.
   * @param replaceAll - explicit all-occurrences mode.
   * @returns write outcome or a typed refusal.
   */
  async patchBody(
    owner: SkillWriteOwner,
    name: string,
    oldString: string,
    newString: string,
    replaceAll = false,
    origin: WriteOrigin = 'foreground',
  ): Promise<SkillWriteServiceResult> {
    const target = await this.library.identify(skillBodyTarget(name))
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return refusal(observed.kind)
    const result = await this.library.patch(name, oldString, newString, '', replaceAll, origin, anchorOf(observed.version))
    if (result.ok) await this.readBody(owner, name)
    return actionResult(result)
  }

  /**
   * Replace one support file only when this owner observed its current version.
   * @param owner - exact writer identity.
   * @param name - skill name.
   * @param filePath - support path.
   * @param content - full next bytes.
   * @returns write outcome or a typed refusal.
   */
  async updateSupport(owner: SkillWriteOwner, name: string, filePath: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillWriteServiceResult> {
    const target = await this.library.identify(skillSupportTarget(name, filePath))
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return refusal(observed.kind)
    const result = await this.library.writeSupportFile(name, filePath, content, origin, anchorOf(observed.version))
    if (result.ok) await this.readSupport(owner, name, filePath)
    return actionResult(result)
  }

  /** Remove a support file only after this owner read it at the observed version. */
  async removeSupport(owner: SkillWriteOwner, name: string, filePath: string, origin: WriteOrigin = 'foreground'): Promise<SkillWriteServiceResult> {
    const target = await this.library.identify(skillSupportTarget(name, filePath))
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return refusal(observed.kind)
    const result = await this.library.removeSupportFile(name, filePath, origin, anchorOf(observed.version))
    if (result.ok) this.observations.record(owner, target, { kind: 'absent' })
    return actionResult(result)
  }

  /**
   * Create a support file when absent, or update it only after this owner read it.
   * A new support file is a createIfAbsent (no prior read is required); an
   * existing unread file is refused rather than overwritten.
   */
  async writeSupport(owner: SkillWriteOwner, name: string, filePath: string, content: string, origin: WriteOrigin = 'foreground'): Promise<SkillWriteServiceResult> {
    const target = await this.library.identify(skillSupportTarget(name, filePath))
    const observed = this.observations.get(owner, target)
    if (observed === undefined) {
      const current = await this.library.readSupportFile(name, filePath)
      if (current !== null) return { ok: false, code: 'SKILL_NOT_OBSERVED', message: 'read the skill target before writing it' }
      this.observations.record(owner, target, { kind: 'absent' })
      const created = await this.library.writeSupportFile(name, filePath, content, origin)
      if (created.ok) await this.readSupport(owner, name, filePath)
      return actionResult(created)
    }
    if (observed.kind === 'absent') {
      const created = await this.library.writeSupportFile(name, filePath, content, origin)
      if (created.ok) await this.readSupport(owner, name, filePath)
      return actionResult(created)
    }
    return await this.updateSupport(owner, name, filePath, content, origin)
  }

  /** Record a just-committed SKILL.md write for this owner (create/fallback path). */
  async observeBodyWrite(owner: SkillWriteOwner, name: string): Promise<void> {
    await this.readBody(owner, name)
  }

  /** Record a just-committed support-file write for this owner (fallback path). */
  async observeSupportWrite(owner: SkillWriteOwner, name: string, filePath: string): Promise<void> {
    await this.readSupport(owner, name, filePath)
  }

  private record(owner: SkillWriteOwner, target: ReturnType<typeof skillBodyTarget>, content: string | null): void {
    this.observations.record(owner, target, content === null
      ? { kind: 'absent' }
      : { kind: 'present', version: contentHash(content) })
  }


}

function refusal(kind: 'unobserved' | 'absent'): SkillWriteServiceResult {
  return kind === 'unobserved'
    ? { ok: false, code: 'SKILL_NOT_OBSERVED', message: 'read the skill target before writing it' }
    : { ok: false, code: 'SKILL_NOT_FOUND', message: 'skill target does not exist' }
}

function planRefusal(kind: 'unobserved' | 'absent'): SkillWritePlanResult {
  return refusal(kind) as SkillWritePlanResult
}

function notObserved(): SkillWritePlanResult {
  return planRefusal('unobserved')
}

function anchorOf(version: string): WriteAnchor { return { sha256: version } }

function actionResult(result: { ok: boolean; message: string; noop?: boolean; stale?: true; anchor?: 'match' | 'drift' | 'missing'; path?: string; normalizedFrontmatterFields?: readonly string[] }): SkillWriteServiceResult {
  if (result.ok) return { ok: true, message: result.message, ...(result.noop === true ? { noop: true } : {}), ...(result.path === undefined ? {} : { path: result.path }), ...(result.normalizedFrontmatterFields === undefined ? {} : { normalizedFrontmatterFields: result.normalizedFrontmatterFields }) }
  if (result.stale === true) return { ok: false, code: 'SKILL_STALE_VERSION', message: result.message }
  return { ok: false, code: 'SKILL_INVALID', message: result.message }
}
