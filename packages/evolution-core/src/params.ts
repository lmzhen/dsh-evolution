/**
 * Parameter id consolidation (G0/S0.2): one semantic gets ONE id.
 *
 * Nine places in this family carry the same value under two carriers: three use
 * the SAME name in two carriers (reviewMode, staleAfterDays, archiveAfterDays —
 * resolved by the existing policy-shadows-row rule) and six use DIFFERENT names.
 * This module owns the six: the policy/snapshot name is the canonical id, the
 * plugin-row name is a deprecated alias kept readable for one minor version
 * (0.6.x) and removable in 0.7.0.
 *
 * Reading stays compatible (a carrier still spelling the legacy name resolves),
 * writing is strict (the write path accepts canonical ids only, so no new
 * document is created under a deprecated name).
 * @module
 */

/** Deprecated alias (plugin-row name) -> canonical id (policy/snapshot name). */
export const PARAM_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  memoryInterval: 'reviewMemoryInterval',
  skillInterval: 'reviewSkillInterval',
  intervalHours: 'curatorIntervalHours',
  maxSkillContentChars: 'skillContentChars',
  memoryCharLimit: 'memoryChars',
  userCharLimit: 'userChars',
})

/** Canonical ids that have at least one deprecated alias, for read fallback. */
const ALIASES_BY_CANONICAL: Readonly<Record<string, readonly string[]>> = (() => {
  const index: Record<string, string[]> = {}
  for (const [alias, canonical] of Object.entries(PARAM_ALIASES)) {
    ;(index[canonical] ??= []).push(alias)
  }
  return index
})()

/**
 * Resolve any parameter id to its canonical form.
 * @param id - canonical id or deprecated alias.
 * @returns the canonical id; ids without an alias pass through unchanged.
 */
export function resolveParamId(id: string): string {
  return PARAM_ALIASES[id] ?? id
}

/**
 * Whether an id is a deprecated alias.
 * @param id - parameter id to test.
 * @returns true when the id must be migrated to its canonical form.
 */
export function isDeprecatedParamId(id: string): boolean {
  return PARAM_ALIASES[id] !== undefined
}

/**
 * Guard for the write path: only canonical ids may be written.
 * @param id - parameter id a caller intends to write.
 * @returns the canonical id.
 * @throws {Error} when the id is a deprecated alias; the message names both ids.
 */
export function canonicalWriteId(id: string): string {
  const canonical = PARAM_ALIASES[id]
  if (canonical === undefined) return id
  throw new Error(`parameter id \`${id}\` is deprecated; write \`${canonical}\` instead`)
}

/**
 * Read a parameter from a carrier that may still spell the legacy name.
 * @param carrier - config/snapshot object to read from, or undefined.
 * @param id - canonical id (a deprecated alias is accepted and resolved first).
 * @returns the canonical value when present, else the alias value, else undefined.
 */
export function readParam(carrier: object | undefined, id: string): unknown {
  if (carrier === undefined) return undefined
  const record = carrier as Record<string, unknown>
  const canonical = resolveParamId(id)
  if (record[canonical] !== undefined) return record[canonical]
  for (const alias of ALIASES_BY_CANONICAL[canonical] ?? []) {
    if (record[alias] !== undefined) return record[alias]
  }
  return undefined
}

/** Exposure group (design §7.2): the unit a developer changes together. */
export type ParamGroup = 'library' | 'write-caps' | 'review' | 'memory' | 'curator' | 'deployment' | 'internal'

/** Exposure tier (design §7.1): the interface combination a parameter gets. */
export type ParamTier = 'E0' | 'E1' | 'E2' | 'E3' | 'E4'

/** Where the authoritative value lives. */
export type ParamAuthority = 'code' | 'cordis' | 'install'

/**
 * One parameter's exposure contract (design §8.1).
 *
 * MACHINE-READ CONTRACT: the entries below are written ONE PER LINE with the
 * key order id, group, tier, authority, owner, applies, docAnchor, summary so
 * the .mjs generators (`gen-param-docs.mjs`, `verify-param-registry.mjs`) can
 * parse this text without importing TypeScript. `param-registry.spec.ts`
 * asserts that the parsed text and this runtime array agree, so the two sides
 * cannot drift.
 *
 * `applies` is the SETTINGS-side timing: 'none' means the parameter is not
 * writable through the user layer (a cordis.yml change still follows the
 * deployment's patch-reload policy).
 */
export interface ParamExposure {
  id: string
  group: ParamGroup
  tier: ParamTier
  authority: ParamAuthority
  owner: string
  applies: 'live' | 'restart' | 'none'
  docAnchor: string
  summary: string
}

/**
 * The parameter registry. G1/S1.1 seeds it with the review group (G-C); the
 * remaining groups land in S2.1. E3 = behaviour preference the user may change
 * (live); E2 = resource or identity knob that stays with the deployment.
 */
export const PARAM_EXPOSURE: readonly ParamExposure[] = Object.freeze([
  { id: 'reviewSkillInterval', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'docs/parameters.md#review', summary: 'Activity units between skill-review injections.' },
  { id: 'reviewMemoryInterval', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'docs/parameters.md#review', summary: 'Activity units between memory-review injections.' },
  { id: 'skillReviewTrigger', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'docs/parameters.md#review', summary: 'Which channel may inject a skill review (cadence, completion, both).' },
  { id: 'skillReviewCompletionMinToolCalls', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'docs/parameters.md#review', summary: 'Tool calls a task needs before the completion channel injects.' },
  { id: 'reviewEnabled', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'docs/parameters.md#review', summary: 'Master switch for the review plugin.' },
  { id: 'reviewMode', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'docs/parameters.md#review', summary: 'Run the review in the parent session (inject) or on a subagent.' },
  { id: 'reviewWakeInject', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'docs/parameters.md#review', summary: 'Deliver the deferred review as a waking follow-up message.' },
  { id: 'reviewProvider', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'docs/parameters.md#review', summary: 'LLM provider for review subagents (deployment identity).' },
  { id: 'reviewTimeoutMs', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'docs/parameters.md#review', summary: 'Bound on one review subagent run and its write leg.' },
  { id: 'reviewContextMessages', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'docs/parameters.md#review', summary: 'Messages of context handed to a review subagent.' },
  { id: 'reviewMessageChars', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'docs/parameters.md#review', summary: 'Per-message character budget of the review context.' },
  { id: 'reviewMaxDepth', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'docs/parameters.md#review', summary: 'Absolute delegation-depth cap of the review subagent.' },
  { id: 'reviewToolAllow', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'docs/parameters.md#review', summary: 'Tools the review subagent may use (safety surface).' },
])
/**
 * Number-typed read over {@link readParam}: the family's tunables are numbers,
 * and a value of another type reads as absent so the caller's default applies
 * (the same outcome the numeric clamps produce for a malformed value).
 * @param carrier - config/snapshot object to read from, or undefined.
 * @param id - canonical id (a deprecated alias is accepted and resolved first).
 * @returns the resolved number, or undefined when absent or not a number.
 */
export function readNumberParam(carrier: object | undefined, id: string): number | undefined {
  const value = readParam(carrier, id)
  return typeof value === 'number' ? value : undefined
}
