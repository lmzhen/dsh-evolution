/**
 * Deterministic skill curator: active → stale → archived transitions.
 * Pure function; file moves are performed by SkillLibrary.
 */

import type { UsageMap } from './usage.ts'
import { latestActivityAt } from './usage.ts'

export interface CuratorConfig {
  staleAfterDays: number
  archiveAfterDays: number
  pruneBuiltins: boolean
}

export interface CuratorTransition {
  name: string
  from: 'active' | 'stale' | 'archived'
  to: 'stale' | 'archived' | 'active'
  reason: string
}

export interface CuratorResult {
  transitions: CuratorTransition[]
  archive: string[]
  reactivate: string[]
  markStale: string[]
}

export const PROTECTED_BUILTIN_SKILLS: ReadonlySet<string> = new Set(['plan'])

function daysSince(iso: string | null, created: string, now: number): number {
  const anchor = iso ?? created
  return (now - new Date(anchor).getTime()) / 86_400_000
}

export function computeLifecycleTransitions(
  usage: UsageMap,
  config: CuratorConfig,
  now = new Date(),
): CuratorResult {
  const result: CuratorResult = { transitions: [], archive: [], reactivate: [], markStale: [] }
  for (const [name, record] of usage) {
    if (record.pinned) continue
    if (record.created_by !== 'agent') continue
    if (PROTECTED_BUILTIN_SKILLS.has(name)) continue
    if (record.state === 'archived') continue

    const age = daysSince(null, record.created_at, now.getTime())
    if (record.use_count === 0 && age < config.staleAfterDays) continue

    const idle = daysSince(latestActivityAt(record), record.created_at, now.getTime())
    if (record.state === 'active') {
      if (idle >= config.archiveAfterDays) {
        record.state = 'archived'
        record.archived_at = now.toISOString()
        result.transitions.push({ name, from: 'active', to: 'archived', reason: `idle ${Math.round(idle)}d >= ${config.archiveAfterDays}d` })
        result.archive.push(name)
      } else if (idle >= config.staleAfterDays) {
        record.state = 'stale'
        result.transitions.push({ name, from: 'active', to: 'stale', reason: `idle ${Math.round(idle)}d >= ${config.staleAfterDays}d` })
        result.markStale.push(name)
      }
    } else if (record.state === 'stale') {
      if (idle < config.staleAfterDays) {
        record.state = 'active'
        result.transitions.push({ name, from: 'stale', to: 'active', reason: `recent activity ${Math.round(idle)}d` })
        result.reactivate.push(name)
      } else if (idle >= config.archiveAfterDays) {
        record.state = 'archived'
        record.archived_at = now.toISOString()
        result.transitions.push({ name, from: 'stale', to: 'archived', reason: `idle ${Math.round(idle)}d >= ${config.archiveAfterDays}d` })
        result.archive.push(name)
      }
    }
  }
  return result
}
