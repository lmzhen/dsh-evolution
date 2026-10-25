/** One limits snapshot shared by authoring, validation and commit. */
import { createHash } from 'node:crypto'
import { DEFAULT_SKILL_LIMITS, policyStageLimits, type SkillLimits } from '@deepseek-ai/dsh-evolution-core'
export interface MergeLimitsSnapshot {
  readonly skillLimits: SkillLimits
  readonly limitsDigest: string
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}'
}
export function resolveLimitsSnapshot(policy?: Parameters<typeof policyStageLimits>[0]): MergeLimitsSnapshot {
  const skillLimits: SkillLimits = { ...DEFAULT_SKILL_LIMITS, ...policyStageLimits(policy) }
  return { skillLimits, limitsDigest: createHash('sha256').update(canonical(skillLimits)).digest('hex') }
}
export function limitsSnapshotOf(skillLimits: SkillLimits): MergeLimitsSnapshot {
  return { skillLimits, limitsDigest: createHash('sha256').update(canonical(skillLimits)).digest('hex') }
}
export function mergeLimitFinding(path: string, limit: string, observed: number, limitValue: number): { readonly rule: string; readonly path: string; readonly severity: 'block'; readonly code: 'limit'; readonly limit: string; readonly observed: number; readonly limitValue: number; readonly message: string } {
  return { rule: 'limit', path, severity: 'block', code: 'limit', limit, observed, limitValue, message: path + ' exceeds ' + limit + ' (' + String(observed) + ' > ' + String(limitValue) + ')' }
}
