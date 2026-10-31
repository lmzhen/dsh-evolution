/** Read-only card projection for UI; counts are intentionally separate. */
export interface DiscoveryCardView {
  readonly id: string
  readonly title: string
  readonly purpose: string
  readonly descriptionStatus: 'fresh' | 'stale' | 'failed'
  readonly triggers: readonly string[]
  readonly managedModelInvocableCount: number
  readonly externalCatalogCount: number
  readonly pendingCount: number
  readonly mapStale: boolean
  readonly asOf: string
}

/** Read-only product state; no L1/L2 tree or task view. */
export interface DiscoveryUiState {
  readonly cards: readonly DiscoveryCardView[]
  readonly unclassifiedCount: number
  readonly mapStale: boolean
  readonly completeness: 'complete' | 'partial' | 'unavailable'
  readonly asOf: string
  readonly searchEnabled: boolean
}

/** Allowed user policy fields; anything else is rejected. */
export interface DiscoveryUserPolicy {
  readonly mode?: 'auto' | 'off' | 'on' | undefined
  readonly maxCards?: number | undefined
  readonly tokenBudget?: number | undefined
  readonly staleAfterHours?: number | undefined
  readonly pinDomains?: readonly string[] | undefined
  readonly disableDomains?: readonly string[] | undefined
}

const POLICY_KEYS = new Set(['mode', 'maxCards', 'tokenBudget', 'staleAfterHours', 'pinDomains', 'disableDomains'])
const MODES = new Set(['auto', 'off', 'on'])

/** @returns true when the policy only edits supported fields. */
export function isDiscoveryUserPolicy(value: unknown): value is DiscoveryUserPolicy {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !POLICY_KEYS.has(key))) return false
  if (record.mode !== undefined && (typeof record.mode !== 'string' || !MODES.has(record.mode))) return false
  if (record.maxCards !== undefined && (typeof record.maxCards !== 'number' || !Number.isSafeInteger(record.maxCards) || record.maxCards < 1)) return false
  if (record.tokenBudget !== undefined && (typeof record.tokenBudget !== 'number' || !Number.isSafeInteger(record.tokenBudget) || record.tokenBudget < 1)) return false
  if (record.staleAfterHours !== undefined && (typeof record.staleAfterHours !== 'number' || record.staleAfterHours <= 0)) return false
  if (record.pinDomains !== undefined && !Array.isArray(record.pinDomains)) return false
  if (record.disableDomains !== undefined && !Array.isArray(record.disableDomains)) return false
  return true
}

/** Static skill_manage description; no dynamic domain list/count/tree. */
export const SKILL_MANAGE_DESCRIPTION = 'Manage skill content. create may include an optional domain proposal when create-side domain cards are available; no proposal means unclassified. Domain assignment never blocks skill creation and is stored as a sidecar.'

/** Future skill_domains contract; NOT a search parameter and not implemented in v0. */
export interface SkillDomainsContract {
  readonly action: 'list' | 'expand'
  readonly domainId?: string | undefined
  readonly depth?: 1 | 2 | undefined
}

/** Replayable behavior metrics; no prompt sentence lock. */
export interface DiscoveryBehaviorObservation {
  readonly awarenessShown: boolean
  readonly awarenessRecalled: boolean
  readonly silentMiss: boolean
  readonly searched: boolean
  readonly overSearch: boolean
  readonly underSearch: boolean
  readonly wrongLoad: boolean
  readonly taskSuccess: boolean
  readonly tokens: number
  readonly fallback: boolean
}

/** Behavior metrics for one fixture/replay batch. */
export interface DiscoveryBehaviorMetrics {
  readonly awarenessRecall: number | null
  readonly silentMissRate: number | null
  readonly overSearchRate: number | null
  readonly underSearchRate: number | null
  readonly wrongLoadRate: number | null
  readonly taskSuccess: number | null
  readonly tokens: number
  readonly fallbackRate: number | null
  readonly total: number
}

/** @returns recomputable behavior metrics; null means no denominator. */
export function computeBehaviorMetrics(observations: readonly DiscoveryBehaviorObservation[]): DiscoveryBehaviorMetrics {
  const total = observations.length
  const shown = observations.filter(item => item.awarenessShown).length
  const searched = observations.filter(item => item.searched).length
  const successes = observations.filter(item => item.taskSuccess).length
  return {
    awarenessRecall: shown === 0 ? null : observations.filter(item => item.awarenessShown && item.awarenessRecalled).length / shown,
    silentMissRate: shown === 0 ? null : observations.filter(item => item.silentMiss).length / shown,
    overSearchRate: searched === 0 ? null : observations.filter(item => item.searched && item.overSearch).length / searched,
    underSearchRate: searched === 0 ? null : observations.filter(item => item.searched && item.underSearch).length / searched,
    wrongLoadRate: searched === 0 ? null : observations.filter(item => item.searched && item.wrongLoad).length / searched,
    taskSuccess: total === 0 ? null : successes / total,
    tokens: observations.reduce((sum, item) => sum + item.tokens, 0),
    fallbackRate: searched === 0 ? null : observations.filter(item => item.searched && item.fallback).length / searched,
    total,
  }
}
