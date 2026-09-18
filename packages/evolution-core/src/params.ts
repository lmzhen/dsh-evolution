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
  { id: 'reviewSkillInterval', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Activity units between skill-review injections.' },
  { id: 'reviewMemoryInterval', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Activity units between memory-review injections.' },
  { id: 'skillReviewTrigger', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Which channel may inject a skill review (cadence, completion, both).' },
  { id: 'skillReviewCompletionMinToolCalls', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Tool calls a task needs before the completion channel injects.' },
  { id: 'reviewEnabled', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Master switch for the review plugin.' },
  { id: 'reviewMode', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Run the review in the parent session (inject) or on a subagent.' },
  { id: 'reviewWakeInject', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Deliver the deferred review as a waking follow-up message.' },
  { id: 'reviewProvider', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'LLM provider for review subagents (deployment identity).' },
  { id: 'reviewTimeoutMs', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Bound on one review subagent run and its write leg.' },
  { id: 'reviewContextMessages', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Messages of context handed to a review subagent.' },
  { id: 'reviewMessageChars', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Per-message character budget of the review context.' },
  { id: 'reviewMaxDepth', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Absolute delegation-depth cap of the review subagent.' },
  { id: 'reviewToolAllow', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Tools the review subagent may use (safety surface).' },
  { id: 'skillContentChars', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Character cap on a SKILL.md body (tighten-only).' },
  { id: 'maxSkillFileBytes', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Byte cap on one support file (tighten-only).' },
  { id: 'maxSkillNameLength', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Character cap on a skill name (tighten-only).' },
  { id: 'maxDescriptionLength', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Character cap on a skill description (tighten-only).' },
  { id: 'descriptionStrict', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Refuse a description over the authoring bar instead of advising.' },
  { id: 'strictCrossSource', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Refuse writes whose catalog entry resolves outside the family.' },
  { id: 'citationPolicy', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'restart', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Refuse a move that would leave a dangling reference, or verify it.' },
  { id: 'referenceRewrite', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'restart', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Re-home support files and rewrite references during a merge (plan or apply).' },
  { id: 'archiveRetention', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'restart', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Report expired archives, or prune them.' },
  { id: 'supportFileCharPolicy', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'restart', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Warn about an oversize support file, or refuse the write.' },
  { id: 'memoryChars', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'memory-files', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Character budget the memory store enforces for MEMORY.md.' },
  { id: 'userChars', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'memory-files', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Character budget the memory store enforces for USER.md.' },
  { id: 'memoryEnabled', group: 'memory', tier: 'E2', authority: 'cordis', owner: 'tool-memory', applies: 'none', docAnchor: 'PARAMETERS.md#memory', summary: 'Register the memory tool and its prompt section at all (deployment switch).' },
  { id: 'entryPreviewChars', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'tool-memory', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Characters of one memory entry shown in a tool result preview.' },
  { id: 'addDatePrefix', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'memory-files', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Prefix stored memory entries with their date heading.' },
  { id: 'maxConsolidationFailures', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'memory-files', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Consolidation failures one turn tolerates before the tool gives up.' },
  { id: 'curatorIntervalHours', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Minimum hours between deterministic curation passes.' },
  { id: 'staleAfterDays', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Inactive days before a skill counts as stale.' },
  { id: 'archiveAfterDays', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Inactive days before a stale skill is archived (must be >= staleAfterDays).' },
  { id: 'qualityWarnStaleAfterDays', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Age at which a low quality score starts warning.' },
  { id: 'minIdleHours', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Idle hours required before an automatic curation pass runs.' },
  { id: 'minIdleFailOpen', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Let the idle gate open when the activity probe is unavailable.' },
  { id: 'llmReview', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Enable the LLM nomination pass on top of the deterministic lifecycle.' },
  { id: 'curatorReviewMaxTokens', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Token budget of the curator LLM review.' },
  { id: 'curatorReviewTimeoutMs', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Wall-clock bound of the curator LLM review.' },
  { id: 'healthSoftBodyChars', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Body character line the health view judges against.' },
  { id: 'healthStampDensityPerKb', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Stamp density per KB that flags log-like content in a body.' },
  { id: 'healthChurnMinPatches', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Patches without a read that flag a write-ghost skill.' },
  { id: 'evolution-curator.enabled', group: 'curator', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#curator', summary: 'Mount the curator plugin at all.' },
  { id: 'autoStart', group: 'curator', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#curator', summary: 'Arm the hourly due-ness tick with the plugin.' },
  { id: 'bootGraceSeconds', group: 'curator', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#curator', summary: 'Grace period before the first automatic pass after a restart.' },
  { id: 'curatorProvider', group: 'curator', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#curator', summary: 'LLM provider for curator reviews (deployment identity).' },
  { id: 'curatorModel', group: 'curator', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#curator', summary: 'Model for curator reviews (deployment identity).' },
  { id: 'protectedSkillNames', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Skills the lifecycle never archives or rewrites.' },
  { id: 'manageUnmanaged', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Let curation touch skills with no family metadata.' },
  { id: 'pruneBuiltins', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Let curation nominate bundled skills for pruning.' },
  { id: 'referencedSkillNames', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Names treated as referenced by external docs (never retired).' },
  { id: 'includeSkillNames', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-skill-catalog', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Allow-list of skills the catalog exposes.' },
  { id: 'skill-catalog.excludeSkillNames', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-skill-catalog', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Deny-list of skills the catalog hides (row-local name; see the collision note).' },
  { id: 'modelInvocable', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-skill-catalog', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Default for whether the model may invoke a catalog skill.' },
  { id: 'userInvocable', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-skill-catalog', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Default for whether the user may invoke a catalog skill.' },
  { id: 'maxItems', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-activity', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Entries kept in the activity sidecar window.' },
  { id: 'sessionScoped', group: 'library', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Act only on sessions carrying the family model tools.' },
  { id: 'skill-usage.sessionScoped', group: 'library', tier: 'E2', authority: 'cordis', owner: 'skill-usage', applies: 'none', docAnchor: 'PARAMETERS.md#library', summary: 'Keep the usage sidecar scoped per session (row-local name).' },
  { id: 'evolution-review.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Skill-tree root for review-created skills (empty = shared default).' },
  { id: 'evolution-review.skillsRoot', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Retired alias of root; a value here fails the load (V27 G2.4).' },
  { id: 'evolution-curator.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-curator', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Skill-tree root for curator scope, snapshot and archive.' },
  { id: 'evolution-commands.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-commands', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Skill-tree root the command surface writes through.' },
  { id: 'evolution-commands.skillsRoot', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-commands', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Retired alias of the commands root; a value here fails the load.' },
  { id: 'evolution-maintenance.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-maintenance', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Skill-tree root the maintenance probe scans.' },
  { id: 'evolution-maintenance.skillsRoot', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-maintenance', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Accepted skill-root spelling for the maintenance row.' },
  { id: 'evolution-skill-catalog.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-skill-catalog', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Skill-tree root the catalog lists.' },
  { id: 'evolution-learning-graph.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-learning-graph', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Skill-tree root the learning graph reads.' },
  { id: 'skill-usage.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'skill-usage', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Skill-tree root the usage store observes.' },
  { id: 'skill-usage.eventsHome', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'skill-usage', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Directory holding the family event log the usage store reads.' },
  { id: 'evolution-state-json.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-state-json', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Directory holding the JSON state store.' },
  { id: 'memory-files.root', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'memory-files', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Directory holding MEMORY.md and USER.md (empty = $DSH_HOME/memories).' },
  { id: 'evolution-feedback.path', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-feedback', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Event log the feedback scorer reads (empty = family events file).' },
  { id: 'evolution-state.provider', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-state', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Registered state-store provider name.' },
  { id: 'memory.provider', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'memory', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Registered memory provider name.' },
  { id: 'memory-files.providerName', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'memory-files', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Name this package registers as the memory provider.' },
  { id: 'memoryReviewModel', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Model for the memory review channel (deployment identity).' },
  { id: 'skillReviewModel', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Model for the skill review channel (deployment identity).' },
  { id: 'maxOpsPerPlan', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-plan-validator', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Operation cap one staged plan may carry.' },
  { id: 'substantiveMinToolCalls', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Tool calls that make a turn count as substantive.' },
  { id: 'substantiveMinUserChars', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'User characters that make a turn count as substantive.' },
  { id: 'substantiveMinAgentChars', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Assistant characters that make a turn count as substantive.' },
  { id: 'threatExemptLabels', group: 'deployment', tier: 'E1', authority: 'cordis', owner: 'evolution-threat', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Threat labels the deployment declares benign (safety surface, never user-writable).' },
  { id: 'evolution-threat.enabled', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-threat', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Mount the write-time threat guard at all.' },
  { id: 'evolution-threat.maxScanChars', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-threat', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Scan window size of the threat guard.' },
  { id: 'evolution-approval.enabled', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-approval', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Require approval before a staged write executes.' },
  { id: 'evolution-approval.stageForeground', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-approval', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Stage foreground agent writes for approval too.' },
  { id: 'qualityWarnThreshold', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-feedback', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Feedback score below which a skill carries a warning.' },
  { id: 'replay.maxPlans', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-replay', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Plans compared in one replay report.' },
  { id: 'replay.weights', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-replay', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Scoring weights of the replay comparison.' },
  { id: 'evolution-commands.maintainCooldownMs', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-commands', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Cooldown between maintenance runs from the command surface.' },
  { id: 'evolution-commands.maintainTimeoutMs', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'evolution-commands', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Timeout of one maintenance run started from the command surface.' },
  { id: 'skill-usage.supportReadToolNames', group: 'deployment', tier: 'E2', authority: 'cordis', owner: 'skill-usage', applies: 'none', docAnchor: 'PARAMETERS.md#deployment', summary: 'Tool names whose file reads are attributed to support files.' },
  { id: 'install.mode', group: 'deployment', tier: 'E4', authority: 'install', owner: 'scripts', applies: 'restart', docAnchor: 'PARAMETERS.md#deployment', summary: 'Install target plane (layered preset vs profile-root bundle).' },
  { id: 'install.basePreset', group: 'deployment', tier: 'E4', authority: 'install', owner: 'scripts', applies: 'restart', docAnchor: 'PARAMETERS.md#deployment', summary: 'Agent-preset base the layered install composes from (--base).' },
  { id: 'install.home', group: 'deployment', tier: 'E4', authority: 'install', owner: 'scripts', applies: 'restart', docAnchor: 'PARAMETERS.md#deployment', summary: 'Harness home the installer writes into (--home).' },
  { id: 'install.presetRowOverrides', group: 'deployment', tier: 'E4', authority: 'install', owner: 'scripts', applies: 'restart', docAnchor: 'PARAMETERS.md#deployment', summary: 'Preset row overrides the installer injects (row-overrides.json).' },
])

/** The settings namespace each OWNER PACKAGE registers (design §7.2).
 *
 * Keyed by owner rather than by group because a namespace has exactly one
 * registrant (the platform refuses a second registration of the same name),
 * while a group may span packages — group 'memory' is served by memory-files and
 * tool-memory, each owning its own section. A package without an entry has no
 * user layer (its knobs stay deployment-only). */
export const PARAM_NAMESPACES: Readonly<Record<string, string>> = Object.freeze({
  'evolution-review': 'evolution-review',
  'memory-files': 'evolution-memory',
  'tool-memory': 'evolution-tool-memory',
  'evolution-curator': 'evolution-curator',
  'tool-skill-manage': 'evolution-skills',
})

/** Structural view of one registered settings scope (platform Service Definition).
 * Declared locally so this module keeps its zero-import, zero-dependency shape. */
interface SettingsScopeLike {
  get(): unknown
  watch(callback: (next: unknown, prev: unknown) => void): () => void
}

/** Structural view of the platform settings provider; only the members the
 * family uses are named. A missing `describe` disables the user layer loudly
 * (see {@link paramSectionOverrides}) instead of reading as 'no overrides'. */
export interface SettingsProviderLike {
  register(namespace: string, schema: unknown, options: {
    base: unknown
    applies?: 'live' | 'restart'
    /** Owner-side refusal of a resolved section (cross-field rules the schema
     * cannot express); throwing refuses the WRITE that produced the value. */
    validate?: (value: unknown) => void
  }): SettingsScopeLike
  describe?(options?: { redactSecrets?: boolean }): { ns: string; user?: Record<string, unknown> }[]
}

/** Hooks a caller may supply when a section attaches to the settings service.
 * @typeParam T - the section's value type (what `validate` inspects). */
export interface ParamSectionOptions<T extends object = object> {
  /** Called once when the user layer turns unreadable (a warning, never silent). */
  warn?: (message: string) => void
  /** Called after every committed change that the reader can observe — the place
   * to REBUILD registration-level facts (the platform's own `installSection`
   * documents the same hook shape). Consumers that read at use time pass nothing. */
  onChange?: () => void
  /** Refuse a resolved section the owner could not act on: a cross-field rule the
   * schema cannot express (the platform applies this hook to the RESOLVED section,
   * so a user value is judged together with the deployment layer beneath it).
   * Throwing refuses the write that produced the value. */
  validate?: (value: T) => void
}

/** Reader for one parameter section: presence-aware user overrides. */
export interface ParamOverrides<T extends object> {
  /** The namespace this reader is bound to. */
  readonly namespace: string
  /** The user-set value for one key, or undefined when the user never set it. */
  get<K extends keyof T & string>(key: K): T[K] | undefined
  /** The resolved section (defaults < base < user) — display and tests. */
  resolved(): T
}

/**
 * G3: expose one parameter section to the user layer.
 *
 * Precedence stays 'user > deployment > default': the caller keeps reading its
 * deployment carriers (policy snapshot, then the plugin row) and consults
 * {@link ParamOverrides.get} FIRST — an unset key returns undefined, so the
 * deployment value keeps winning and the family's shadowing rules survive.
 *
 * Failure posture: a provider without `describe` (or one whose describe throws)
 * leaves the user layer UNAVAILABLE and warns once — deployment values then
 * apply. Treating an unreadable user layer as 'no overrides' would silently
 * ignore a setting the user did write, so the warning names it.
 * @typeParam T - the section's value type.
 * @param provider - the platform settings provider, or undefined when absent.
 * @param namespace - namespace to register.
 * @param schema - schemastery schema the platform validates against.
 * @param base - composition base layer (the plugin row's values).
 * @param options - warning sink and the change hook.
 * @returns a reader bound to the namespace.
 */
export function paramSectionOverrides<T extends object>(
  provider: SettingsProviderLike | undefined,
  namespace: string,
  schema: unknown,
  base: T,
  options: ParamSectionOptions<T> = {},
): ParamOverrides<T> {
  if (provider === undefined) return unavailableOverrides(namespace, base)
  const scope = options.validate === undefined
    ? provider.register(namespace, schema, { base, applies: 'live' })
    : provider.register(namespace, schema, { base, applies: 'live', validate: options.validate as (value: unknown) => void })
  const warn = options.warn ?? ((): void => {})
  let user: Record<string, unknown> | undefined = readUserLayer(provider, namespace)
  if (user === undefined) warn('settings provider for ' + namespace + ' exposes no readable user layer; deployment values apply')
  scope.watch(() => {
    const next = readUserLayer(provider, namespace)
    if (next === undefined) {
      warn('settings provider for ' + namespace + ' stopped exposing its user layer; deployment values apply')
      user = undefined
      options.onChange?.()
      return
    }
    user = next
    options.onChange?.()
  })
  return {
    namespace,
    get: <K extends keyof T & string>(key: K): T[K] | undefined =>
      user === undefined ? undefined : user[key] as T[K] | undefined,
    resolved: () => (scope.get() ?? base) as T,
  }
}

/** The pre-provider reader: no user layer, deployment values only. */
function unavailableOverrides<T extends object>(namespace: string, base: T): ParamOverrides<T> {
  return { namespace, get: () => undefined, resolved: () => base }
}

/** Read the raw user section, or undefined when the provider cannot report it. */
function readUserLayer(provider: SettingsProviderLike, namespace: string): Record<string, unknown> | undefined {
  if (provider.describe === undefined) return undefined
  try {
    return provider.describe({ redactSecrets: false }).find(entry => entry.ns === namespace)?.user ?? {}
  } catch {
    return undefined
  }
}

/** Minimal structural view of the cordis context used to attach a section.
 * The callback takes `unknown` on purpose: cordis's own `inject` declares a
 * `Context` parameter, and a callback accepting `unknown` is assignable to it
 * (parameter contravariance) while a narrower shape is not. */
export interface SettingsHostLike {
  inject(names: string[], callback: (ctx: unknown) => void): unknown
}

/**
 * Attach a parameter section through the optional settings service.
 * @typeParam T - the section's value type.
 * @param host - the plugin context (structurally typed).
 * @param namespace - namespace to register.
 * @param schema - schemastery schema the platform validates against.
 * @param base - composition base layer (the plugin row's values).
 * @param options - warning sink and the change hook.
 * @returns a reader that follows the provider when it appears.
 */
export function installParamSection<T extends object>(
  host: SettingsHostLike,
  namespace: string,
  schema: unknown,
  base: T,
  options: ParamSectionOptions<T> = {},
): ParamOverrides<T> {
  let current = unavailableOverrides(namespace, base)
  host.inject(['settings'], (injected) => {
    const settings = (injected as { settings: SettingsProviderLike }).settings
    current = paramSectionOverrides(settings, namespace, schema, base, options)
    // The section is live from the moment it attaches, so consumers that cached
    // a derived fact before the provider existed rebuild it now.
    options.onChange?.()
  })
  return {
    namespace,
    get: key => current.get(key),
    resolved: () => current.resolved(),
  }
}

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
