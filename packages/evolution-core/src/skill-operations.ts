/**
 * User-facing operation identities shared by the stats UI, command copy and history labels.
 *
 * The tool/command layers own execution; this table owns only presentation semantics. Keeping it in
 * core means a UI label and a success-count key cannot drift into two spellings of the same action.
 * @module @deepseek-ai/dsh-evolution-core
 */

/** Operations that can be counted in the library summary. */
export type SkillOperationId = 'offload' | 'condense' | 'extract'

/** Where one operation belongs on the C-end surface. */
export type SkillOperationSurface = 'primary' | 'advanced' | 'hidden'

/** One operation's presentation identity; label keys resolve in the UI catalog. */
export interface SkillOperationMeta {
  readonly id: SkillOperationId
  readonly labelKey: string
  readonly descriptionKey: string
  readonly kind: 'deterministic' | 'agent'
  readonly surface: SkillOperationSurface
}

/** The one operation table. Unknown ids never gain a label by accident. */
export const SKILL_OPERATIONS: readonly SkillOperationMeta[] = Object.freeze([
  {
    id: 'offload',
    labelKey: 'operation.offload.label',
    descriptionKey: 'operation.offload.description',
    kind: 'deterministic',
    surface: 'advanced',
  },
  {
    id: 'condense',
    labelKey: 'operation.condense.label',
    descriptionKey: 'operation.condense.description',
    kind: 'agent',
    surface: 'advanced',
  },
  {
    id: 'extract',
    labelKey: 'operation.extract.label',
    descriptionKey: 'operation.extract.description',
    kind: 'agent',
    surface: 'advanced',
  },
])
