/**
 * Plan-level write types for the single skill-write provider.
 *
 * This is NOT a second low-level intent layer: `skill-write-intent.ts` owns
 * create/replace/edit decisions and `mutation-unit.ts` owns the transaction.
 * A plan is the domain-level unit the tool, approval and system writers share;
 * `SkillLibrary.apply(plan)` maps each op to the existing mutators/intent.
 *
 * @module @deepseek-ai/dsh-evolution-core/skill-write-plan
 */
import type { SkillTarget } from './skill-observation.ts'
import type { SkillSectionEdit, WriteOrigin } from './skill-store.ts'

/** What the writer observed for one target before planning the write. */
export type SkillWriteExpect =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly version: string }

/** One domain write in a plan. */
export type SkillWriteOp =
  | {
    readonly kind: 'createSkill'
    readonly skill: string
    readonly content: string
    readonly managed?: boolean
  }
  | {
    readonly kind: 'write'
    readonly target: SkillTarget
    readonly content: string
    readonly expect: SkillWriteExpect
  }
  | {
    readonly kind: 'patch'
    readonly target: SkillTarget
    readonly oldString: string
    readonly newString: string
    readonly replaceAll: boolean
    readonly expect: { readonly kind: 'present'; readonly version: string }
  }
  | {
    readonly kind: 'patchSection'
    readonly target: SkillTarget
    readonly section: SkillSectionEdit
    readonly expect: { readonly kind: 'present'; readonly version: string }
  }
  | {
    readonly kind: 'remove'
    readonly target: SkillTarget
    readonly expect: { readonly kind: 'present'; readonly version: string }
  }

/** The complete write a caller intends to commit. */
export interface SkillWritePlan {
  readonly origin: WriteOrigin
  readonly ops: readonly SkillWriteOp[]
  readonly summary?: string
  readonly stagedAt?: string
}

/** One target's committed result; bytes/version are filled by the provider. */
export interface SkillWriteOutcome {
  readonly op: SkillWriteOp
  readonly target: SkillTarget
  readonly before?: string | null
  readonly after?: string | null
  readonly version?: string
  readonly noop?: boolean
}

/** Result of one plan. H1 wrappers leave `outcomes` empty until the provider fills it. */
export interface SkillWriteResult {
  readonly ok: boolean
  readonly message: string
  readonly outcomes: readonly SkillWriteOutcome[]
  readonly warnings?: readonly string[]
}
