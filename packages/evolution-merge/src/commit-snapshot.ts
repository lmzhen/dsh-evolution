/** Pre-commit snapshot: enough to restore the target and archived sources after a crash. */
import { join } from 'node:path'
import type { CommitMergePlan, EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

export interface CommitSnapshot {
  readonly runId: string
  readonly target: string
  readonly create: boolean
  readonly sources: readonly string[]
  readonly targetBody: string | null
  readonly sourceBodies: readonly { readonly name: string; readonly body: string }[]
  readonly at: string
}

export function snapshotPath(home: string, runId: string): string {
  return join(home, 'merge', 'snapshots', runId.replace(/[^A-Za-z0-9_-]+/g, '_') + '.json')
}

export async function writeCommitSnapshot(io: EvolutionIoLike, home: string, runId: string, plan: CommitMergePlan, now: number): Promise<CommitSnapshot> {
  const snapshot: CommitSnapshot = {
    runId, target: plan.target, create: !plan.targetExists, sources: plan.sources,
    targetBody: plan.expectedTargetBody, sourceBodies: plan.expectedSourceBodies.map(item => ({ name: item.name, body: item.body })),
    at: new Date(now).toISOString(),
  }
  await io.writeText(snapshotPath(home, runId), JSON.stringify(snapshot, null, 2))
  return snapshot
}

export async function readCommitSnapshot(io: EvolutionIoLike, home: string, runId: string): Promise<CommitSnapshot | null> {
  const raw = await io.readText(snapshotPath(home, runId))
  if (raw === null) return null
  try { return JSON.parse(raw) as CommitSnapshot } catch { return null }
}

export function skillBodyPath(home: string, name: string): string {
  return join(home, 'skills', name, 'SKILL.md')
}
