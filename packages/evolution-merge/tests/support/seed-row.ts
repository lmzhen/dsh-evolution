// Test-only v4 row seeder: tests no longer write through the legacy v3 writer.
import { probeText, transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeRow } from '../../src/contracts.ts'
import { legacyToV3 } from '../../src/domain/row-v3-bridge.ts'
import { v3ToV4 } from '../../src/domain/row-v4.ts'
import { normalizeV3State, parseV4State } from '../../src/domain/schema4.ts'
import { createPre1bBackup } from '../../src/domain/pre-1b-backup.ts'
import { ensureMergeStateReady, mergeStatePath } from '../../src/domain/state-bootstrap.ts'

/** Seed/replace one v2-shaped fixture row in a v4 state with a pre-1b manifest. */
export async function seedRow(io: EvolutionIoLike, home: string, row: MergeRow): Promise<void> {
  const target = legacyToV3(row)
  if (target === null) throw new Error('invalid fixture row')
  const initial = await probeText(io, mergeStatePath(home))
  let raw = initial.kind === 'present' ? initial.value : null
  let existing = raw === null ? null : parseV4State(raw)
  if (existing === null) {
    const ready = await ensureMergeStateReady(io, home)
    if (!ready.ok) throw new Error(ready.code + ': ' + ready.message)
    if ((await probeText(io, mergeStatePath(home))).kind === 'absent') await io.writeText(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [] }))
    const backup = await createPre1bBackup(io, home)
    if (!backup.ok) throw new Error(backup.message)
    existing = normalizeV3State({ schemaVersion: 3, rows: ready.state.rows }, { backupRef: backup.id, at: 'seed' })
    raw = JSON.stringify(existing, null, 2)
  }
  const rows = existing.rows.filter(item => item.pairKey !== target.pairKey).concat(v3ToV4(target))
  await transactIo(io, mergeStatePath(home), () => JSON.stringify({ ...existing, rows }, null, 2))
}
