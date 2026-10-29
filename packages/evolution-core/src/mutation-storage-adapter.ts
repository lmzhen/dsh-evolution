import { join } from 'node:path'
import { contentHash } from './mutations.ts'
import { readUnitSnapshot, unitSnapshotsDir, unitStorageKey, writeUnitSnapshot, type UnitSnapshot } from './unit-storage.ts'
import { writeUnitJournal, type UnitJournal, type UnitJournalPhase } from './unit-journal.ts'
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
      await writeUnitSnapshot(io, home, body)
    },
    async read(unitId: string): Promise<MutationSnapshot | null> {
      const snapshot = await readUnitSnapshot(io, home, unitId)
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
      const names = await io.list(unitSnapshotsDir(home))
      const out: MutationSnapshot[] = []
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const raw = await io.readText(join(unitSnapshotsDir(home), name))
        if (raw === null) continue
        let snapshot: UnitSnapshot
        try {
          snapshot = JSON.parse(raw) as UnitSnapshot
        } catch {
          continue
        }
        if (snapshot.kind !== 'tree-change' || snapshot.mutationState !== 'prepared' || snapshot.ops === undefined) continue
        out.push({ unitId: snapshot.unitId, state: 'prepared', ops: snapshot.ops, ...(snapshot.cleanup === undefined ? {} : { cleanup: snapshot.cleanup }), createdAt: snapshot.createdAt })
      }
      return out
    },
  }
}

const PHASE: Record<MutationJournalRecord['phase'], UnitJournalPhase> = {
  prepared: 'prepared',
  'unit-written': 'unit-written',
  committed: 'committed',
  failed: 'failed',
  undone: 'rolled-back',
}

/**
 * Production adapter onto the existing unit journal. It never writes a second
 * journal file; merge and tree-change units share the one journal directory.
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
        updatedAt: Date.now(),
      }
      await writeUnitJournal(io, home, journal)
    },
  }
}
