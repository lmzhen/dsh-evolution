/**
 * File-backed gate cache: <home>/merge/gate-cache.json.
 * Reads are three-state; a malformed file is reported, not overwritten. Writes are one
 * transact so two runs cannot interleave a partial cache.
 */
import { join } from 'node:path'
import { probeText, transactIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { GateCache } from './ladder.ts'

export const GATE_CACHE_VERSION = 1

export function gateCachePath(home: string): string {
  return join(home, 'merge', 'gate-cache.json')
}

export interface LoadGateCacheResult {
  readonly cache: GateCache
  readonly note?: string
}

export async function loadGateCache(io: EvolutionIoLike, home: string): Promise<LoadGateCacheResult> {
  const probe = await probeText(io, gateCachePath(home))
  if (probe.kind === 'absent') return { cache: new GateCache() }
  if (probe.kind === 'unknown') return { cache: new GateCache(), note: probe.reason }
  try {
    const parsed = JSON.parse(probe.value) as { schemaVersion?: unknown; entries?: unknown }
    if (parsed.schemaVersion !== GATE_CACHE_VERSION || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return { cache: new GateCache(), note: 'gate cache has an unexpected shape' }
    }
    return { cache: GateCache.fromObject(parsed.entries) }
  } catch (error) {
    return { cache: new GateCache(), note: 'gate cache is not JSON: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

export async function saveGateCache(io: EvolutionIoLike, home: string, cache: GateCache): Promise<void> {
  await transactIo(io, gateCachePath(home), () => JSON.stringify({ schemaVersion: GATE_CACHE_VERSION, entries: cache.toObject() }, null, 2) + '\n')
}

export function hasGateCache(cache: GateCache): boolean {
  return cache.size > 0
}

