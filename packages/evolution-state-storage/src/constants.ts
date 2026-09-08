/**
 * Single source for the state-stack magic strings (audit v10 S-06).
 *
 * The singleton curator key, the on-disk state file names, the provider names
 * and the domain table names live here so the two providers (json/domain)
 * cannot drift a literal independently — a drifted literal is exactly the
 * E-10 divergence class both providers already guard against elsewhere.
 * These values are FORMAT-STABLE: the file names and the `'primary'` key are
 * on-disk contracts, the provider names are registry keys, and the table
 * names are domain-spec keys — renaming any of them orphans data or breaks
 * the seam, never rename casually.
 * @module @deepseek-ai/dsh-evolution-state-storage/src/constants
 */

/** Singleton curator-state record key in both providers (the json map key and
 * the domain table key). */
export const CURATOR_STATE_KEY = 'primary'

/** On-disk state file names (json provider, relative to its configured root). */
export const REVIEW_STATE_FILE = 'review-state.json'
export const CURATOR_STATE_FILE = 'curator-state.json'
export const PENDING_STATE_FILE = 'pending-state.json'
/** Pre-split approval store; read-only legacy, retired after the merge. */
export const PENDING_LEGACY_FILE = 'pending.json'
export const PENDING_ARCHIVE_FILE = 'pending-state-archive.json'
/** Rotation sidecar of {@link PENDING_ARCHIVE_FILE} (V4-01). */
export const PENDING_ARCHIVE_BAK_FILE = 'pending-state-archive.json.bak'

/** Provider names as registered on the `evolutionStateStorage` seam. */
export const PROVIDER_JSON = 'json'
export const PROVIDER_DOMAIN = 'domain'

/** Domain table names of the evolution storage-domain spec. */
export const REVIEW_STATE_TABLE = 'review_state'
export const CURATOR_STATE_TABLE = 'curator_state'
export const PENDING_TABLE = 'pending'
