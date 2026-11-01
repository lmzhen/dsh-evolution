import type { BootstrapSkillFact } from './domain-bootstrap.ts'
import type { SkillIndexRow } from './identity.ts'

/**
 * Convert live model-invocable rows into the initial-map writer's real facts.
 * @param rows - current view rows.
 * @returns stable keys and three-field hashes, never synthetic values.
 */
export function bootstrapFactsFromRows(rows: readonly SkillIndexRow[]): readonly BootstrapSkillFact[] {
  return rows
    .filter(row => row.modelInvocable)
    .map(row => ({
      name: row.name,
      description: row.description,
      ...row.whenToUse === undefined ? {} : { whenToUse: row.whenToUse },
      skillKey: row.skillKey,
      threeFieldHash: row.threeFieldHash,
    }))
}
