/**
 * Exemption evaluation (W9-gates §3.2).
 *
 * An exemption is a debt with an owner and a due version, not a way to silence a ledger. The audit
 * found the opposite: 41 entries whose `expiry` was free prose ("release gate: revisit when…") and
 * which no code ever evaluated, so the same renewals could ride forever. This module is the one
 * evaluator both the exemption gate and `verify-mutations` use, so an entry cannot be valid in one
 * place and ignored in the other.
 * @module @deepseek-ai/dsh-evolution-scripts/lib-exemptions
 */
import { versionReached } from './lib-family-version.mjs'

/**
 * Problems with one exemption entry against the current family version.
 * @param entry - the registered exemption (reason / owner / expiry / plan).
 * @param currentVersion - the family version the tree is at.
 * @returns the problems; an empty list means the exemption is valid and may be honoured.
 */
export function exemptionProblems(entry, currentVersion) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return ['not an object']
  const problems = []
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') problems.push('missing reason')
  if (typeof entry.owner !== 'string' || entry.owner.trim() === '') problems.push('missing owner')
  if (typeof entry.plan !== 'string' || entry.plan.trim() === '') problems.push('missing plan (the reduction this debt is scheduled for)')
  if (typeof entry.expiry !== 'string' || entry.expiry.trim() === '') {
    problems.push('missing expiry')
    return problems
  }
  const reached = versionReached(currentVersion, entry.expiry)
  if (reached === null) problems.push('expiry "' + entry.expiry + '" is not a version, so it can never be evaluated')
  else if (reached === true) problems.push('expired at ' + entry.expiry + ' (family is ' + currentVersion + ')')
  return problems
}

/**
 * Evaluate a named registry of exemptions.
 * @param registry - id → entry.
 * @param currentVersion - the family version.
 * @returns one row per entry.
 */
export function evaluateExemptions(registry, currentVersion) {
  const rows = []
  for (const [id, entry] of Object.entries(registry ?? {})) {
    rows.push({ id, problems: exemptionProblems(entry, currentVersion) })
  }
  return rows
}
