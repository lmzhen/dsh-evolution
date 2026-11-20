/**
 * The first service layer over skill observations and the CAS primitive.
 *
 * It is intentionally narrow while Phase C moves behavior off the tool:
 * read records an observation for one owner; update/patch derive their expected
 * version from that observation and execute through `SkillLibrary.writeFileCas`
 * under its serial + mutation locks. No tool wiring happens here yet, so the
 * existing create/update/patch paths keep their behavior.
 *
 * @module @deepseek-ai/dsh-evolution-core/skill-write-service
 */
import { contentHash } from './mutations.ts'
import type { SkillLibrary } from './skill-store.ts'
import type { SkillObservationStore } from './skill-observation.ts'
import { skillBodyTarget, skillSupportTarget } from './skill-observation.ts'
import type { SkillWriteRefusalReason } from './skill-write-intent.ts'

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
  | { readonly ok: true; readonly content?: string | null }
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
    const target = skillBodyTarget(name)
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
    const target = skillSupportTarget(name, filePath)
    const content = await this.library.readSupportFile(name, filePath)
    this.record(owner, target, content)
    return content
  }

  /**
   * Replace SKILL.md only when this owner observed its current version.
   * @param owner - exact writer identity.
   * @param name - skill name.
   * @param content - full next body.
   * @returns write outcome or a typed refusal.
   */
  async updateBody(owner: SkillWriteOwner, name: string, content: string): Promise<SkillWriteServiceResult> {
    const target = skillBodyTarget(name)
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return refusal(observed.kind)
    return this.apply(name, '', { kind: 'replaceIfVersion', expected: observed.version, next: content })
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
  ): Promise<SkillWriteServiceResult> {
    const target = skillBodyTarget(name)
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return refusal(observed.kind)
    return this.apply(name, '', {
      kind: 'editIfVersion',
      expected: observed.version,
      oldString,
      newString,
      ...(replaceAll ? { replaceAll: true } : {}),
    })
  }

  /**
   * Replace one support file only when this owner observed its current version.
   * @param owner - exact writer identity.
   * @param name - skill name.
   * @param filePath - support path.
   * @param content - full next bytes.
   * @returns write outcome or a typed refusal.
   */
  async updateSupport(owner: SkillWriteOwner, name: string, filePath: string, content: string): Promise<SkillWriteServiceResult> {
    const target = skillSupportTarget(name, filePath)
    const observed = this.observations.requirePresent(owner, target)
    if (!('version' in observed)) return refusal(observed.kind)
    return this.apply(name, filePath, { kind: 'replaceIfVersion', expected: observed.version, next: content })
  }

  private record(owner: SkillWriteOwner, target: ReturnType<typeof skillBodyTarget>, content: string | null): void {
    this.observations.record(owner, target, content === null
      ? { kind: 'absent' }
      : { kind: 'present', version: contentHash(content) })
  }

  private async apply(name: string, filePath: string, intent: Parameters<SkillLibrary['writeFileCas']>[2]): Promise<SkillWriteServiceResult> {
    const result = await this.library.writeFileCas(name, filePath, intent)
    if (result.ok) return { ok: true }
    return {
      ok: false,
      code: codeOf(result.reason),
      message: result.message,
    }
  }
}

function refusal(kind: 'unobserved' | 'absent'): SkillWriteServiceResult {
  return kind === 'unobserved'
    ? { ok: false, code: 'SKILL_NOT_OBSERVED', message: 'read the skill target before writing it' }
    : { ok: false, code: 'SKILL_NOT_FOUND', message: 'skill target does not exist' }
}

function codeOf(reason: SkillWriteRefusalReason | undefined): SkillWriteErrorCode {
  switch (reason) {
    case 'already-exists': return 'SKILL_ALREADY_EXISTS'
    case 'not-found': return 'SKILL_NOT_FOUND'
    case 'stale': return 'SKILL_STALE_VERSION'
    case 'not-found-match': return 'SKILL_EDIT_NOT_FOUND'
    case 'ambiguous': return 'SKILL_AMBIGUOUS_EDIT'
    case 'invalid': return 'SKILL_INVALID'
    default: return 'SKILL_INVALID'
  }
}
