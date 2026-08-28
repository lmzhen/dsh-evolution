/**
 * The control-plane protection sets, held once and queried everywhere
 * (decision B, rc.44 plan M2): the lifecycle engine, the scope view, the LLM
 * nomination gate and the control-plane consolidate all answer "is this name
 * off limits — and why" from the same instance, so the gate sets can never
 * drift apart the way the three pre-rc.46 implementations did.
 *
 * Scope boundary: a GateSet covers NAME-SET protections only. Marker-based
 * protections (pinned / bundled / hub-installed) are file markers resolved by
 * `SkillLibrary.writeProtection` / `deleteProtection` — they depend on the
 * filesystem and the write origin, not on a name list.
 * @module @deepseek-ai/dsh-evolution-core
 */

import { PROTECTED_BUILTIN_SKILLS } from './constants.ts'

export type GateReason = 'excluded' | 'referenced' | 'suppressed' | 'protected-builtin'

export interface GateSetInputs {
  exclude?: ReadonlySet<string> | undefined
  referenced?: ReadonlySet<string> | undefined
  suppressed?: ReadonlySet<string> | undefined
}

export class EvolutionGateSet {
  readonly exclude: ReadonlySet<string>
  readonly referenced: ReadonlySet<string>
  readonly suppressed: ReadonlySet<string>

  constructor(inputs: GateSetInputs = {}) {
    this.exclude = inputs.exclude ?? new Set()
    this.referenced = inputs.referenced ?? new Set()
    this.suppressed = inputs.suppressed ?? new Set()
  }

  /**
   * The first protection blocking this name, or null. Any hit blocks — the
   * order is diagnostic only, so a name in two sets reports the first.
   */
  blockReason(name: string): GateReason | null {
    if (this.exclude.has(name)) return 'excluded'
    if (this.referenced.has(name)) return 'referenced'
    if (this.suppressed.has(name)) return 'suppressed'
    if (PROTECTED_BUILTIN_SKILLS.has(name)) return 'protected-builtin'
    return null
  }

  isBlocked(name: string): boolean {
    return this.blockReason(name) !== null
  }
}

/** Build a GateSet from the curator-style config field names. */
export function createGateSet(config: {
  excludeSkillNames?: ReadonlySet<string>
  referencedSkillNames?: ReadonlySet<string>
  suppressedNames?: ReadonlySet<string>
}): EvolutionGateSet {
  return new EvolutionGateSet({
    exclude: config.excludeSkillNames,
    referenced: config.referencedSkillNames,
    suppressed: config.suppressedNames,
  })
}
