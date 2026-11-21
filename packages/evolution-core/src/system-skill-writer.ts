/**
 * System-owned skill writes: the same provider, without session observations.
 *
 * Curator/merge/undo callers build a plan with an explicit snapshot/anchor; the
 * write still takes the provider's target lock, unit transaction and audit.
 *
 * @module @deepseek-ai/dsh-evolution-core/system-skill-writer
 */
import type { SkillWritePlan, SkillWriteResult } from './skill-write-plan.ts'
import type { SkillLibrary } from './skill-store.ts'

export class SystemSkillWriter {
  constructor(private readonly library: SkillLibrary) {}

  /**
   * Apply one explicit plan through the single provider.
   * @param plan - origin, ops and the caller's snapshot anchors.
   * @returns the provider result; no observation is recorded.
   */
  async apply(plan: SkillWritePlan): Promise<SkillWriteResult> {
    return await this.library.apply(plan)
  }
}
