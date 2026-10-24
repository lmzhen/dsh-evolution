/** G2 recovery arbitration: unit journal/evidence wins over a legacy commit journal. */
import type { EvolutionIoLike } from './io.ts'
import { readUnitEvidence, readUnitSnapshot } from './unit-storage.ts'
import { readUnitJournal } from './unit-journal.ts'

export type UnitAuthority = 'unit' | 'legacy' | 'none'

export async function resolveUnitAuthority(io: EvolutionIoLike, home: string, unitId: string, legacyExists: boolean): Promise<UnitAuthority> {
  if (await readUnitEvidence(io, home, unitId) !== null) return 'unit'
  if (await readUnitJournal(io, home, unitId) !== null) return 'unit'
  if (await readUnitSnapshot(io, home, unitId) !== null) return 'unit'
  return legacyExists ? 'legacy' : 'none'
}
