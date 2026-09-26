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

/**
 * Required argument names per `skill_manage` action — the SINGLE SOURCE read
 * by the tool's argument gate (tool-skill-manage write-gates.ts) and the plan
 * validator (evolution-plan-validator), so the two can never drift.
 * OPT-05 (2026-09): the plan validator used to accept a `write_file`/
 * `remove_file` op without `file_path` while the executor required it — the
 * staged write then failed at EVERY approve until rejected.
 * Rows here are the op-level requirements only: `delete` additionally
 * requires `absorbed_into` at the PLAN layer (review passes may only delete
 * into an umbrella) and `pin`/`unpin` are tool-only actions — each consumer
 * adds its own extras on top of this table. An empty-string argument is NOT
 * caught here (the tool's gate deliberately lets it reach the library for a
 * more specific remedy message); the validator adds its own `.trim()`
 * emptiness checks for payload fields.
 */
export const SKILL_ACTION_REQUIRED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  create: ['name', 'content'],
  edit: ['name', 'content'],
  update: ['name', 'content'],
  patch: ['name', 'old_string', 'new_string'],
  delete: ['name'],
  write_file: ['name', 'file_path', 'file_content'],
  remove_file: ['name', 'file_path'],
  restructure: ['name'],
  pin: ['name'],
  unpin: ['name'],
}

/** Skill frontmatter `name` validated for the file name (lowercase + hyphen).
 * 计划 B-4 (v18): tightened to the UPSTREAM `SKILL_NAME` shape
 * (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, packages/skill/skill/src/index.ts:21). The
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

/** The authoring DISCIPLINE band, taken from the upstream standard (archive §5):
 * peer skills sit at 8-14k characters and a body pushing past 20k belongs in
 * `references/*.md`. Deliberately separate from `MAX_SKILL_CONTENT_CHARS`: the
 * hard ceiling is a deployment-tunable limit, this band is the authoring
 * standard — deriving the band from the ceiling is exactly what let a 40k
 * ceiling hide a 99k body without a single signal saying "split me" (V3). */
export const AUTHORING_SPLIT_LINE_CHARS = 20_000

/** Upstream's conversion basis for CHARACTER LIMITS: 2.75 chars/token, labelled
 * model-independent in the config template (\`cli-config.yaml.example:538\`), and the
 * basis behind every quoted token figure there — memory 2200 chars ≈ 800 tokens,
 * user 1375 ≈ 500, SKILL.md 100_000 ≈ 36k (\`tools/skill_manager_tool.py:455\`).
 * Limits are deliberately conservative, so this is the basis a BORROWED LIMIT must
 * be converted with. */
export const UPSTREAM_LIMIT_CHARS_PER_TOKEN = 2.75

/** The platform's own estimate basis: \`CHARS_PER_TOKEN = 4\` in
 * \`@deepseek-ai/dsh-token-meter/estimate.ts\` (its comment reads "used until exact
 * tokenization is needed"), matching upstream's ESTIMATE-side heuristic — "~4
 * chars/token is the usual English heuristic" (\`agent/prompt_builder.py:1179\`).
 * Estimates use this; limits use the constant above. */
export const PLATFORM_ESTIMATE_CHARS_PER_TOKEN = 4
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
/** Threat-scan WINDOW SIZE (not a total cap — E-12: the whole text is scanned in
 * overlapping windows, so content beyond this stays in scope). The coverage
 * floor is `PATTERN_OVERLAP + 1` (V6-05). Single home for the core scanners'
 * default parameter and clamp fallback, plus evolution-threat's Config default
 * — the two packages previously wrote 65_536 independently (G0/S0.1). */
export const DEFAULT_THREAT_MAX_SCAN_CHARS = 65_536

/** 0.3.17 (S3.10, T-1): control-plane fields a model-facing write call may
 * never carry — single source for plan-validator, evolution-policy and the
 * threat scanner (they used to each hardcode the list).
 * P2-13 (v37): staged_from_sha256 joins the list — it is the replay's own
 * staleness anchor, and the tool-arguments root is an OPEN object, so a model
 * could otherwise choose the anchor that decides the write's outcome. */
export const FORBIDDEN_CONTROL_KEYS = ['policy', 'threshold', 'prompt_hash', 'model_route', 'evolution_config', 'staged_from_sha256'] as const

/** 0.3.17 (S3.10): the model-facing write tools the policy guard and threat
 * scanner cover. */
export const EVOLUTION_WRITE_TOOLS = ['memory', 'skill_manage'] as const

/** Hermes authoring quality bar for descriptions (the 60-char Rule). The
 * platform's own index limit stays in validateFrontmatter; this bar is the
 * target the authoring standard names, enforced as ADVISORY feedback.
 * 0.3.16 (T-4): moved here from skill-store.ts so drift-signals (pure, no IO)
 * can reference it without importing the skill-store module. */
export const AUTHORING_DESCRIPTION_BAR = 60

/** The PLATFORM's default cap on the description a skill catalog shows —
 * `catalogDescriptionMaxLength` on the platform's `tool-skill` row (default 500).
 *
 * Recorded here because it is the third number in the description-length relationship, and the one
 * that is easiest to misread as a family rule: the family's own host/all rows SET that field to
 * `AUTHORING_DESCRIPTION_BAR` (60), so what a family deployment truncates at is the ROW's value —
 * this default only governs compositions that do not override it. It is NOT a refusal threshold:
 * the only refusal is `MAX_DESCRIPTION_LENGTH` / the row's `maxDescriptionLength`, and the catalog
 * cut is a view, not a validation. See tool-skill-manage/README.md for the three-number table. */
export const PLATFORM_CATALOG_DESCRIPTION_DEFAULT = 500

/** The split hint both size refusals share (0.5.0 V1). The same sentence used to
 * be copied into validateFrontmatter AND the patch path, and neither copy named
 * where the content should go — the upstream cap message names the destination
 * directories, and that is the part a model actually acts on. */
export const CONTENT_SPLIT_HINT = 'Consider splitting into a smaller SKILL.md with supporting files in references/ or templates.'

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

// ── Model-visible prompt-section orders ──────────────────────────────────────
// The platform's `PromptSection.order` scale is a platform-internal constant
// table (`SECTION_ORDERS`, core/system-prompt), not a published contract: the
// 0.1.5 line re-scaled every first-party section from -1000 to 10200
// (`DEPLOYMENT_PERSONA_SUFFIX` is the highest), so a third-party literal that
// used to sort last could silently sort into the middle of the tool guidance.
// Both family sections are operational guidance for the model, so they belong
// AFTER every first-party section on every line. These values sit above 0.1.5's
// maximum; scripts/verify-platform-contract.mjs --upstream re-reads the
// platform's scale and fails when it grows past them.
/** Order of the `evolution:memory-guidance` section (before the skills one). */
export const MEMORY_GUIDANCE_SECTION_ORDER = 11000
/** Order of the `evolution-skills-guidance` section (last of the two). */
export const SKILLS_GUIDANCE_SECTION_ORDER = 11100
