/** Startup replay for non-terminal commit journals. */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { CommitJournal } from './domain/commit-journal.ts'
import { recoveryFor } from './domain/commit-journal.ts'
import { writeJournal } from './domain/commit-journal-store.ts'
import { readCommitSnapshot, skillBodyPath, skillFilePath } from './commit-snapshot.ts'

export interface CommitRecoveryReport {
  readonly runId: string
  readonly phase: CommitJournal['phase']
  readonly action: string
  readonly ok: boolean
}

export async function recoverCommitJournals(
  io: EvolutionIoLike,
  home: string,
  now: number,
  skillRoot: string,
  restoreSource?: (name: string) => Promise<boolean>,
): Promise<readonly CommitRecoveryReport[]> {
  const dir = join(home, 'merge', 'journals')
  if (!(await io.exists(dir))) return []
  const files = (await io.list(dir)).filter(name => name.endsWith('.json'))
  const reports: CommitRecoveryReport[] = []
  for (const file of files) {
    let journal: CommitJournal
    try { journal = JSON.parse(await io.readText(join(dir, file)) ?? '') as CommitJournal } catch { continue }
    const recovery = recoveryFor(journal)
    if (recovery === 'none') continue
    const snapshot = await readCommitSnapshot(io, home, journal.runId)
    let action = 'report-only'
    let ok = true
    if (recovery === 'retry-commit') {
      action = 'no-host-write'
    } else if (snapshot === null) {
      action = 'snapshot-missing'
      ok = false
    } else {
      try {
        if (recovery === 'rollback-sources') {
          let restoredArchived = restoreSource !== undefined
          if (restoreSource !== undefined) {
            for (const source of snapshot.sourceBodies) {
              if (!(await restoreSource(source.name))) restoredArchived = false
            }
          }
          if (!restoredArchived) {
            for (const source of snapshot.sourceBodies) await io.writeText(skillBodyPath(skillRoot, source.name), source.body)
          }
        }
        if (snapshot.create && snapshot.targetBody === null) {
          try { await io.remove(skillBodyPath(skillRoot, snapshot.target)) } catch { /* already gone */ }
        } else if (snapshot.targetBody !== null) {
          await io.writeText(skillBodyPath(skillRoot, snapshot.target), snapshot.targetBody)
        }
        const oldPaths = new Set((snapshot.targetSupport ?? []).map(file => file.path))
        for (const file of snapshot.targetSupport ?? []) {
          await io.writeText(skillFilePath(skillRoot, snapshot.target, file.path), file.content)
        }
        for (const file of snapshot.targetSupportAfter ?? []) {
          if (!oldPaths.has(file.path)) {
            try { await io.remove(skillFilePath(skillRoot, snapshot.target, file.path)) } catch { /* already gone */ }
          }
        }
        for (const file of snapshot.sourceSupport ?? []) await io.writeText(skillFilePath(skillRoot, file.name, file.path), file.content)
        action = recovery === 'rollback-sources' ? 'restored-sources-and-target' : 'restored-target'
      } catch (error) {
        action = 'restore-failed: ' + (error instanceof Error ? error.message : String(error))
        ok = false
      }
    }
    await writeJournal(io, home, { ...journal, phase: ok ? 'rolled-back' : 'failed', updatedAt: new Date(now).toISOString() })
    reports.push({ runId: journal.runId, phase: journal.phase, action, ok })
  }
  await io.writeText(join(home, 'merge', 'recovery.json'), JSON.stringify(reports, null, 2))
  return reports
}
