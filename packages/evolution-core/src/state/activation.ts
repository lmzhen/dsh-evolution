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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_V2_MIGRATION_MARKER } from './constants.ts'

/** True when the explicit v2 activation marker exists for this evolution home. */
export function isStoreV2Active(home: string): boolean {
  return existsSync(join(home, 'state', STATE_V2_MIGRATION_MARKER))
}

/** Absolute path of the activation marker (used by migration/validation only). */
export function storeV2ActivationPath(home: string): string {
  return join(home, 'state', STATE_V2_MIGRATION_MARKER)
}
