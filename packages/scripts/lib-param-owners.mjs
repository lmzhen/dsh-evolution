/**
 * Settings ROW id -> package directory (G8 structure batching).
 *
 * A parameter's `owner` is the settings row id: the platform keys a settings section by the
 * Loader entry id. Structure batches absorbed the package that used to mount the row into a
 * host package (subpath rows keep their ids), so gates that need the CODE resolve the id
 * through this table. Both the registry check and the consumer check read it — one home.
 */
export const OWNER_ALIASES = new Map([
  ['evolution-contract', 'evolution-core'],
  ['evolution-io', 'evolution-core'],
  ['evolution-io-node', 'evolution-core'],
  ['evolution-authority', 'evolution-core'],
  ['evolution-policy', 'evolution-core'],
  ['evolution-state-storage', 'evolution-state'],
  ['evolution-state-domain', 'evolution-state'],
  ['memory-files', 'memory'],
  ['tool-memory', 'memory'],
  ['skill-usage', 'evolution-skill-discovery'],
  ['evolution-skill-catalog', 'evolution-skill-discovery'],
  ['evolution-feedback', 'evolution-activity'],
  ['evolution-replay', 'evolution-activity'],
  ['evolution-learning-graph', 'evolution-activity'],
  ['evolution-threat', 'evolution-activity'],
])

/** The package directory that carries a settings row id's code. */
export const ownerPackageOf = (owner) => OWNER_ALIASES.get(owner) ?? owner

/**
 * Settings row id -> the SOURCE DIRECTORY that carries the row's code. Absorbed rows live in a
 * host package subpath (G8 batches moved the module, not only the package); gates that read the
 * code follow this map, while gates that assert the package exists use ownerPackageOf above.
 */
export const OWNER_SOURCES = new Map([
  ['memory-files', 'memory/src/files'],
  ['tool-memory', 'memory/src/tools'],
  ['skill-usage', 'evolution-skill-discovery/src/usage'],
  ['evolution-skill-catalog', 'evolution-skill-discovery/src/catalog'],
  ['evolution-feedback', 'evolution-activity/src/feedback'],
  ['evolution-replay', 'evolution-activity/src/replay'],
  ['evolution-learning-graph', 'evolution-activity/src/learning-graph'],
  ['evolution-threat', 'evolution-activity/src/threat'],
  ['evolution-state-domain', 'evolution-state/src/domain'],
  ['evolution-state-storage', 'evolution-state/src'],
  ['evolution-io', 'evolution-core/src'],
  ['evolution-io-node', 'evolution-core/src'],
  ['evolution-authority', 'evolution-core/src'],
  ['evolution-policy', 'evolution-core/src'],
  ['evolution-contract', 'evolution-core/src'],
])

/** The source directory (repo-relative) that carries a settings row id's code. */
export const ownerSourceOf = (owner) => OWNER_SOURCES.get(owner) ?? (ownerPackageOf(owner) + '/src')
