/** Durable pairKey index at <home>/merge/pair-index.json. */
import { join } from 'node:path'
import { transactIo } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { PairIndexEntryV2 } from './indexes.ts'
import { parsePairIndex, serializePairIndex } from './pair-index.ts'

export function pairIndexPath(home: string): string {
  return join(home, 'merge', 'pair-index.json')
}

export async function loadPairIndex(io: EvolutionIoLike, home: string): Promise<Map<string, PairIndexEntryV2>> {
  let raw: string | null = null
  try { raw = await io.readText(pairIndexPath(home)) } catch { return new Map() }
  return parsePairIndex(raw)
}

export async function recordPair(io: EvolutionIoLike, home: string, entry: PairIndexEntryV2): Promise<void> {
  await transactIo(io, pairIndexPath(home), (current) => {
    const index = parsePairIndex(current)
    index.set(entry.pairKey, entry)
    return serializePairIndex(index)
  })
}
