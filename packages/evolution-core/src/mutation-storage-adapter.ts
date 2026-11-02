import { join } from 'node:path'
import { contentHash } from './mutations.ts'
import { readUnitSnapshot, unitSnapshotsDir, unitStorageKey, writeUnitSnapshot, type UnitSnapshot } from './unit-storage.ts'
import { unitJournalPath, writeUnitJournal, type UnitJournal, type UnitJournalPhase } from './unit-journal.ts'
import type { EvolutionIoLike } from './io.ts'
import type { MutationJournalPort, MutationJournalRecord, MutationSnapshot, MutationSnapshotPort } from './mutation-unit.ts'

/**
 * Production adapter onto the existing unit snapshot store. A tree-change
 * snapshot is encoded as a UnitSnapshot with kind='tree-change'; merge
 * snapshots do not carry that kind and are ignored by the reader.
 */
export function unitSnapshotPort(io: EvolutionIoLike, home: string): MutationSnapshotPort {
  return {
    async write(snapshot: MutationSnapshot): Promise<void> {
      const first = snapshot.ops[0]
      const body: UnitSnapshot = {
        schemaVersion: 1,
        unitId: snapshot.unitId,
        planDigest: contentHash(JSON.stringify(snapshot.ops)),
        runId: snapshot.unitId,
        target: first?.target ?? '',
        targetExists: true,
        targetBefore: first?.before ?? null,
        ...(first?.after === null || first?.after === undefined ? {} : { targetAfter: first.after }),
        supportBefore: [],
        supportAfter: [],
        sourceBefore: [],
        origin: 'foreground',
        summary: 'tree-change ' + snapshot.unitId,
        createdAt: snapshot.createdAt,
        kind: 'tree-change',
        mutationState: snapshot.state,
        ...(snapshot.cleanup === undefined ? {} : { cleanup: snapshot.cleanup }),
        ops: snapshot.ops.map(op => ({
          target: op.target,
          before: op.before,
          after: op.after,
          ...(op.skill === undefined ? {} : { skill: op.skill }),
        })),
      }
      await writeUnitSnapshot(io, home, body, 'skill')
    },
    async read(unitId: string): Promise<MutationSnapshot | null> {
      const snapshot = await readUnitSnapshot(io, home, unitId, 'skill') ?? await readUnitSnapshot(io, home, unitId)
      if (snapshot === null || snapshot.kind !== 'tree-change' || snapshot.ops === undefined) return null
      return {
        unitId,
        state: snapshot.mutationState ?? 'committed',
        ops: snapshot.ops,
        ...(snapshot.cleanup === undefined ? {} : { cleanup: snapshot.cleanup }),
        createdAt: snapshot.createdAt,
      }
    },
    async listPrepared(): Promise<MutationSnapshot[]> {
      const out: MutationSnapshot[] = []
      const seen = new Set<string>()
      for (const dir of [unitSnapshotsDir(home, 'skill'), unitSnapshotsDir(home)]) {
        const names = await io.list(dir)
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          const raw = await io.readText(join(dir, name))
          if (raw === null) continue
          let snapshot: UnitSnapshot
          try {
            snapshot = JSON.parse(raw) as UnitSnapshot
          } catch {
            continue
          }
          if (snapshot.kind !== 'tree-change' || snapshot.mutationState !== 'prepared' || snapshot.ops === undefined) continue
          if (seen.has(snapshot.unitId)) continue
          seen.add(snapshot.unitId)
          out.push({ unitId: snapshot.unitId, state: 'prepared', ops: snapshot.ops, ...(snapshot.cleanup === undefined ? {} : { cleanup: snapshot.cleanup }), createdAt: snapshot.createdAt })
        }
      }
      return out
    },
  }
}

/** Keep a bounded number of terminal tree-change snapshots; prepared units are never pruned. */
export async function pruneTreeChangeUnits(io: EvolutionIoLike, home: string, keep = 500): Promise<number> {
  if (!Number.isInteger(keep) || keep < 1) return 0
  const dir = unitSnapshotsDir(home, 'skill')
  const names = await io.list(dir)
  const terminal: Array<{ name: string; unitId: string; createdAt: number }> = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const snapshot = JSON.parse(await io.readText(join(dir, name)) ?? '') as UnitSnapshot
      if (snapshot.kind !== 'tree-change' || snapshot.mutationState === 'prepared') continue
      terminal.push({ name, unitId: snapshot.unitId, createdAt: snapshot.createdAt })
    } catch {
      // unreadable files are left for the explicit recovery/audit path
    }
  }
  terminal.sort((a, b) => b.createdAt - a.createdAt)
  let removed = 0
  for (const entry of terminal.slice(keep)) {
    await io.remove(join(dir, entry.name))
    await io.remove(unitJournalPath(home, entry.unitId, 'skill')).catch(() => {})
    removed += 1
  }
  return removed
}

const PHASE: Record<MutationJournalRecord['phase'], UnitJournalPhase> = {
  prepared: 'prepared',
  'unit-written': 'unit-written',
  committed: 'committed',
  failed: 'failed',
  undone: 'rolled-back',
}

/**
 * Production adapter onto the skill-owned journal directory. Merge recovery
 * reads merge/unit-journals only; legacy tree-change journals carry kind and
 * are skipped by the recovery coordinator.
 */
export function unitJournalPort(io: EvolutionIoLike, home: string): MutationJournalPort {
  return {
    async write(record: MutationJournalRecord): Promise<void> {
      const journal: UnitJournal = {
        schemaVersion: 1,
        unitId: record.unitId,
        runId: record.unitId,
        planDigest: contentHash(JSON.stringify(record)),
        target: record.target ?? record.changed[0] ?? '',
        sources: record.roots ?? [],
        phase: PHASE[record.phase],
        storageKey: unitStorageKey(record.unitId),
        snapshotSha256: contentHash(JSON.stringify(record)),
        kind: 'tree-change',
        updatedAt: Date.now(),
      }
      await writeUnitJournal(io, home, journal, 'skill')
    },
  }
}
