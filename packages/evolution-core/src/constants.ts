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

/** Skill frontmatter `name` validated for the file name (lowercase + hyphen).
 * 计划 B-4 (v18): tightened to the UPSTREAM `SKILL_NAME` shape
 * (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, packages/skill/skill/src/index.ts:20). The
 * old form admitted trailing/consecutive hyphens, which upstream
 * `validateCandidate` throws on — and that throw aborts the WHOLE `ctx.skills`
 * collection. The catalog provider still filters such legacy tree entries so
 * an existing tree cannot break a session. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
/** Skill-review completion channel trigger mode: 'cadence' | 'completion' | 'both'.
 * 0.3.39 (V6-53 follow-up): default is 'cadence' — since 0.3.38 the cadence
 * channel's review is executed at conversation END (deferred), so 'both' would
 * inject a second (task-complete) prompt at the same boundary; the cadence
 * deferral alone IS the end-of-conversation summary. */
export const DEFAULT_SKILL_REVIEW_TRIGGER = 'cadence' as const
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
/** F-20 (v18): the authored-body budget and the hard ceiling are the same
 * number today. Derive it so a future divergence is one edit, not two names
 * that silently disagree. */
export const DEFAULT_SKILL_CONTENT_CHARS = MAX_SKILL_CONTENT_CHARS
/** P3-19 (v14): defaults that were written twice (schema `.default()` AND the
 * clamp fallback literal) now have one home per value. */
export const DEFAULT_REVIEW_TIMEOUT_MS = 120_000
export const DEFAULT_REVIEW_CONTEXT_MESSAGES = 60
export const DEFAULT_REVIEW_MESSAGE_CHARS = 2_000
export const DEFAULT_CURATOR_BOOT_GRACE_SECONDS = 10
export const DEFAULT_CURATOR_REVIEW_MAX_TOKENS = 2_048

/** 0.3.17 (S3.10, T-1): control-plane fields a model-facing write call may
 * never carry — single source for plan-validator, evolution-policy and the
 * threat scanner (they used to each hardcode the list). */
export const FORBIDDEN_CONTROL_KEYS = ['policy', 'threshold', 'prompt_hash', 'model_route', 'evolution_config'] as const

/** 0.3.17 (S3.10): the model-facing write tools the policy guard and threat
 * scanner cover. */
export const EVOLUTION_WRITE_TOOLS = ['memory', 'skill_manage'] as const

/** Hermes authoring quality bar for descriptions (the 60-char Rule). The
 * platform's own index limit stays in validateFrontmatter; this bar is the
 * target the authoring standard names, enforced as ADVISORY feedback.
 * 0.3.16 (T-4): moved here from skill-store.ts so drift-signals (pure, no IO)
 * can reference it without importing the skill-store module. */
export const AUTHORING_DESCRIPTION_BAR = 60

/** V27 G2.4: the largest millisecond delay a timer accepts. `AbortSignal.timeout`
 * (and `setTimeout`) coerce anything larger to 1ms after a Node warning, so a
 * timeout configured above this ceiling silently collapses to "immediately
 * aborted". The curator's review timeout and the review timeout each carried
 * their own copy of the literal; the bound is one protocol constant.
 * (v19 P2-10 corrected the value from 2^32-1 to Node's real 2^31-1 ceiling.) */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** V27 G2.4: the model each review/curation leg defaults to. The policy schema,
 * the policy resolver and the curator's LLM nomination pass each carried their
 * own copy of these strings — a deployment that changed the policy default used
 * to leave the curator passing a different model than the reviews. */
export const DEFAULT_MEMORY_REVIEW_MODEL = 'deepseek-v4-flash'
export const DEFAULT_SKILL_REVIEW_MODEL = 'deepseek-v4-pro'
export const DEFAULT_CURATOR_MODEL = 'deepseek-v4-pro'
