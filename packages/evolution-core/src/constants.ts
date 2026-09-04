/**
 * Shared constants for the dsh-evolution plugin family.
 *
 * Two classes of value live here, deliberately separated by section so future
 * edits do not blur the semantic boundary:
 *
 * 1. **Fixed protocol/format/security invariants** — changing these breaks an
 *    on-disk format, a naming/format contract, a path-security boundary, or a
 *    cross-component invariant. They are NOT exposed as deployment config.
 *
 * 2. **Cross-package shared tunable defaults** — the same semantic default is
 *    read (with a config override path) by more than one package (e.g.
 *    `evolution-policy` and `evolution-curator` both default `staleAfterDays`
 *    to 30). Centralizing them here means one authoritative default: a config
 *    override still applies per package, but the fallback is single-sourced.
 *
 * Package-private tunables (used by exactly one package) stay in that package,
 * not here — see evolution-replay's `DEFAULT_WEIGHTS` and evolution-feedback's
 * threshold, which are intentionally left where they are used.
 * @module @deepseek-ai/dsh-evolution-core
 */

// ── Fixed protocol / format / security invariants ────────────────────────────

/** Skill frontmatter `name` validated for the file name (lowercase + hyphen). */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** Allowed skill support-file subdirectories (path-traversal boundary). */
export const SUPPORT_DIRS = ['references', 'templates', 'scripts', 'assets'] as const

/** Delimiter between durable memory entries (on-disk storage format). */
export const ENTRY_DELIMITER = '\n§\n'

/** Built-in skill names the curator must never lifecycle-manage. */
export const PROTECTED_BUILTIN_SKILLS: ReadonlySet<string> = new Set(['plan'])

// ── Skill-limit bounds ───────────────────────────────────────────────────────
// These are the values that make up `DEFAULT_SKILL_LIMITS` (the shared default
// the tool config lowers/raises from). Kept under their historic names so the
// public export surface is unchanged.

export const MAX_SKILL_NAME_LENGTH = 64
export const MAX_DESCRIPTION_LENGTH = 1024
export const MAX_SKILL_CONTENT_CHARS = 100_000
export const MAX_SKILL_FILE_BYTES = 1_048_576

// ── Cross-package shared tunable defaults ────────────────────────────────────
// Fallback defaults when no config override is set. Single-sourced here;
// packages reference them via `z.default(DEFAULT_*)` or `config.x ?? DEFAULT_*`.

export const DEFAULT_REVIEW_MEMORY_INTERVAL = 10
export const DEFAULT_REVIEW_SKILL_INTERVAL = 10
/** Skill-review completion channel trigger mode: 'cadence' | 'completion' | 'both'. */
export const DEFAULT_SKILL_REVIEW_TRIGGER = 'both' as const
/** Cumulative session tool calls before a session counts as "proven long" for the completion channel. */
export const DEFAULT_SKILL_REVIEW_COMPLETION_MIN_TOOL_CALLS = 20
export const DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS = 3
export const DEFAULT_SUBSTANTIVE_MIN_USER_CHARS = 200
export const DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS = 500
export const DEFAULT_MAX_OPS_PER_PLAN = 32
export const DEFAULT_CURATOR_INTERVAL_HOURS = 168
export const DEFAULT_MIN_IDLE_HOURS = 2
export const DEFAULT_STALE_AFTER_DAYS = 30
export const DEFAULT_ARCHIVE_AFTER_DAYS = 90
export const DEFAULT_MEMORY_CHAR_LIMIT = 2200
export const DEFAULT_USER_CHAR_LIMIT = 1375
/** Consolidation-failure backoff cap, shared by MemoryStore and memory-files' Config default. */
export const DEFAULT_CONSOLIDATION_FAILURES = 3
export const DEFAULT_SKILL_CONTENT_CHARS = 100_000

/** Hermes authoring quality bar for descriptions (the 60-char Rule). The
 * platform's own index limit stays in validateFrontmatter; this bar is the
 * target the authoring standard names, enforced as ADVISORY feedback.
 * 0.3.16 (T-4): moved here from skill-store.ts so drift-signals (pure, no IO)
 * can reference it without importing the skill-store module. */
export const AUTHORING_DESCRIPTION_BAR = 60
