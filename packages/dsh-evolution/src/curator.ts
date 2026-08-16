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
  /** Shorter stale threshold for quality-warned skills; archive threshold never changes. */
  qualityWarnStaleAfterDays?: number
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

export interface CuratorArchivedSkill {
  name: string
  path: string
  reason: string
}

export interface CuratorFailedSkill {
  name: string
  reason: string
}

export interface CuratorRunReport {
  runId: string
  startedAt: string
  finishedAt: string
  staleCandidates: string[]
  llmNominations: string[]
  archiveCandidates: string[]
  archived: CuratorArchivedSkill[]
  failed: CuratorFailedSkill[]
  snapshotPath?: string
}

export interface CuratorReportInput {
  runId: string
  startedAt: string
  finishedAt: string
  staleCandidates: readonly string[]
  llmNominations: readonly string[]
  archiveCandidates: readonly string[]
  archived: readonly CuratorArchivedSkill[]
  failed: readonly CuratorFailedSkill[]
  snapshotPath?: string
}

export function buildCuratorRunReport(input: CuratorReportInput): CuratorRunReport {
  return {
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    staleCandidates: [...input.staleCandidates],
    llmNominations: [...input.llmNominations],
    archiveCandidates: [...input.archiveCandidates],
    archived: [...input.archived],
    failed: [...input.failed],
    ...input.snapshotPath === undefined ? {} : { snapshotPath: input.snapshotPath },
  }
}

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
    const qualityWarn = record.quality_warn === true
    const staleAfterDays = qualityWarn && config.qualityWarnStaleAfterDays !== undefined
      ? config.qualityWarnStaleAfterDays
      : config.staleAfterDays
    if (record.state === 'active') {
      if (idle >= config.archiveAfterDays) {
        record.state = 'archived'
        record.archived_at = now.toISOString()
        result.transitions.push({ name, from: 'active', to: 'archived', reason: `idle ${Math.round(idle)}d >= ${config.archiveAfterDays}d` })
        result.archive.push(name)
      } else if (idle >= staleAfterDays) {
        record.state = 'stale'
        const reason = qualityWarn
          ? `idle ${Math.round(idle)}d >= quality-warn stale ${staleAfterDays}d`
          : `idle ${Math.round(idle)}d >= ${staleAfterDays}d`
        result.transitions.push({ name, from: 'active', to: 'stale', reason })
        result.markStale.push(name)
      }
    } else if (record.state === 'stale') {
      if (idle < staleAfterDays) {
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
