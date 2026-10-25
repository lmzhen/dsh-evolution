import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { mergeStatePath } from '../../src/state.ts'
import { createPre1bBackup } from '../../src/domain/pre-1b-backup.ts'
import { v3ToV4 } from '../../src/domain/row-v4.ts'
import type { V3Row } from '../../src/domain/row-v3.ts'

export interface Schema4Home {
  readonly home: string
  readonly io: ReturnType<typeof nodeEvolutionIo>
  readonly backupId: string
}

export async function makeV4Home(rows: readonly V3Row[] = []): Promise<Schema4Home> {
  const home = await tempRoot('dsh-rg1b2a-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows }))
  const backup = await createPre1bBackup(io, home, '2026-10-25T00:00:00.000Z')
  if (!backup.ok) throw new Error(backup.message)
  const v4 = { schemaVersion: 4, pre1b: { backupRef: backup.id, at: '2026-10-25T00:00:00.000Z' }, rows: rows.map(v3ToV4) }
  await writeFile(mergeStatePath(home), JSON.stringify(v4))
  return { home, io, backupId: backup.id }
}

export const v3Row = (overrides: Partial<V3Row> = {}): V3Row => ({
  id: 'r1', pairKey: 'a\u0000b', a: 'a', b: 'b', state: 'verify', verifySubState: 'unverified',
  version: 1, createdAt: 'c', updatedAt: 'u', origin: 'agent', attempts: 0,
  ...overrides,
} as V3Row)
