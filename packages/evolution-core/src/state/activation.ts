/**
 * DCR-85 activation oracle.
 *
 * One place decides whether the MVCC medium is active for this home. Bridges,
 * providers and guards must not open-code `existsSync(marker)`: a second
 * decision point is how a process ends up with state on v2 and sidecars on the
 * legacy files. The marker's payload is validated by the provider when it
 * mounts; this module only answers the medium question.
 *
 * @module @deepseek-ai/dsh-evolution-core/state/activation
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_V2_MIGRATION_MARKER } from './constants.ts'

export type StoreActivationMode = 'legacy' | 'store-v2'

/** The activation record's durable fields; unknown legacy fields are ignored. */
export interface StoreActivationRecord {
  readonly mode: StoreActivationMode
  readonly generation: number
  readonly commitId?: string | undefined
  readonly lastActiveCommitId?: string | undefined
  readonly migratedAt?: string | undefined
}

export class StoreActivationCorruptError extends Error {
  readonly code = 'store-activation-corrupt'

  constructor(message: string) {
    super(message)
    this.name = 'StoreActivationCorruptError'
  }
}

/** Parse the activation record; an absent marker is legacy, malformed JSON is loud. */
export function readStoreActivation(home: string): StoreActivationRecord | null {
  const path = storeV2ActivationPath(home)
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new StoreActivationCorruptError('the v2 activation marker is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new StoreActivationCorruptError('the v2 activation marker is not an object')
  }
  const record = raw as Record<string, unknown>
  if (record.mode !== undefined && record.mode !== 'legacy' && record.mode !== 'store-v2') {
    throw new StoreActivationCorruptError('the v2 activation marker has an unknown mode')
  }
  const mode: StoreActivationMode = record.mode === 'legacy' ? 'legacy' : 'store-v2'
  return {
    mode,
    generation: typeof record.generation === 'number' && Number.isFinite(record.generation) ? record.generation : 0,
    ...(typeof record.commitId === 'string' ? { commitId: record.commitId } : {}),
    ...(typeof record.lastActiveCommitId === 'string' ? { lastActiveCommitId: record.lastActiveCommitId } : {}),
    ...(typeof record.migratedAt === 'string' ? { migratedAt: record.migratedAt } : {}),
  }
}

/** True when the explicit v2 activation marker exists and is not a rollback record. */
export function isStoreV2Active(home: string): boolean {
  return readStoreActivation(home)?.mode === 'store-v2'
}

/** Absolute path of the activation marker (used by migration/validation only). */
export function storeV2ActivationPath(home: string): string {
  return join(home, 'state', STATE_V2_MIGRATION_MARKER)
}
