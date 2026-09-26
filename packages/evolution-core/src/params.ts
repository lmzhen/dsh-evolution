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

/**
 * Chinese display name per group, one entry per line (the scripts read this block
 * by text, the same way they read PARAM_NAMESPACES). The raw group id is what
 * `--group` accepts and what the JSON face reports; this only names it on screen.
 */
export const PARAM_GROUP_LABELS: Readonly<Record<ParamGroup, string>> = Object.freeze({
  library: '技能库',
  'write-caps': '写入上限',
  review: '会话回顾',
  memory: '记忆',
  curator: '技能整理',
  deployment: '安装配置',
  internal: '内部',
})

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
 *
 * UI METADATA (0.7.0): every E3 row carries the tail
 * `label, hint, control, unit, values` — in that order, directly after
 * `summary`, still one entry per line — plus an OPTIONAL trailing
 * `valueLabels` (0.9.0). E3 is the only tier the settings cards render, so the
 * card's Chinese name, help text, control kind, unit suffix and value domain
 * come from THIS registry and nowhere else; the browser half is generated from
 * this text (`gen-param-client-view.mjs`). Non-E3 rows must NOT carry the tail
 * (there is no UI surface for them); `control: 'select'` requires a non-empty
 * pipe-joined `values`, and `valueLabels` — allowed on select rows only — names
 * those values for display, one label per value, in the same order. The stored
 * value is never translated: only what the control shows.
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
  /** Card label (Chinese, short). Required on E3 rows. */
  label?: string
  /** Card help text (Chinese, one sentence). Required on E3 rows. */
  hint?: string
  /** Which control the card renders for this field. Required on E3 rows. */
  control?: 'number' | 'switch' | 'select' | 'text'
  /** Unit suffix shown next to a number (empty when it carries none). */
  unit?: string
  /** Pipe-joined allowed values; non-empty exactly when control is 'select'. */
  values?: string
  /**
   * Pipe-joined display names for `values`, same order and count (optional).
   * The stored value stays the raw one; this only names it on the card.
   */
  valueLabels?: string
}

/**
 * The parameter registry. G1/S1.1 seeds it with the review group (G-C); the
 * remaining groups land in S2.1. E3 = behaviour preference the user may change
 * (live); E2 = resource or identity knob that stays with the deployment.
 */
export const PARAM_EXPOSURE: readonly ParamExposure[] = Object.freeze([
  { id: 'reviewSkillInterval', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Tool calls between skill-review injections (a turn that made no tool call still counts as one).', label: '技能检查间隔', hint: '每累计多少次工具调用检查一次技能（一轮没有工具调用也算 1 次）。', control: 'number', unit: '次', values: '' },
  { id: 'reviewMemoryInterval', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Tool calls between memory-review injections (a turn that made no tool call still counts as one).', label: '记忆检查间隔', hint: '每累计多少次工具调用检查一次记忆（一轮没有工具调用也算 1 次）。', control: 'number', unit: '次', values: '' },
  { id: 'skillReviewTrigger', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Which channel may inject a skill review (cadence, completion, both).', label: '技能检查时机', hint: '什么时候检查技能：按间隔／按任务完成／两者。', control: 'select', unit: '', values: 'cadence|completion|both', valueLabels: '按间隔|按任务完成|两者' },
  { id: 'skillReviewCompletionMinToolCalls', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Tool calls a task needs before the completion channel injects.', label: '完成时的最少工具调用', hint: '选「按任务完成」时，任务至少用了几次工具才检查。', control: 'number', unit: '次', values: '' },
  { id: 'reviewEnabled', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Master switch for the review plugin.', label: '启用自动检查', hint: '关闭后不再自动回顾会话。', control: 'switch', unit: '', values: '' },
  { id: 'reviewMode', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Run the review in the parent session (inject) or on a subagent.', label: '运行位置', hint: '在哪里运行检查：在当前会话里／交给子代理。', control: 'select', unit: '', values: 'subagent|inject', valueLabels: '交给子代理|在当前会话里' },
  { id: 'reviewWakeInject', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Deliver the deferred review as a waking follow-up message.', label: '延后结果发提醒', hint: '会话空闲时，把延后的检查结果作为一条提醒发给你。', control: 'switch', unit: '', values: '' },
  { id: 'reviewProvider', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'LLM provider for review subagents (deployment identity).' },
  { id: 'reviewTimeoutMs', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Bound on one review subagent run and its write leg.' },
  { id: 'reviewContextMessages', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Messages of context handed to a review subagent.' },
  { id: 'reviewMessageChars', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Per-message character budget of the review context.' },
  { id: 'reviewMaxDepth', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Absolute delegation-depth cap of the review subagent.' },
  { id: 'reviewToolAllow', group: 'review', tier: 'E2', authority: 'cordis', owner: 'evolution-review', applies: 'none', docAnchor: 'PARAMETERS.md#review', summary: 'Tools the review subagent may use (safety surface).' },
  { id: 'skillContentChars', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Character cap on a SKILL.md body (tighten-only).', label: '技能文件正文上限', hint: '技能 Markdown 正文最多多少字符（只能调小）。', control: 'number', unit: '字符', values: '' },
  { id: 'maxSkillFileBytes', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Byte cap on one support file (tighten-only).', label: '附带文件大小上限', hint: '技能附带文件单个最大多少字节（只能调小）。', control: 'number', unit: '字节', values: '' },
  { id: 'maxSkillNameLength', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Character cap on a skill name (tighten-only).', label: '技能名长度上限', hint: '技能名最多多少字符（只能调小）。', control: 'number', unit: '字符', values: '' },
  { id: 'maxDescriptionLength', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Character cap on a skill description (tighten-only).', label: '技能描述长度上限', hint: '技能描述最多多少字符（只能调小）。', control: 'number', unit: '字符', values: '' },
  { id: 'descriptionStrict', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Refuse a description over the authoring bar instead of advising.', label: '描述不合规即拒绝', hint: '描述不符合要求时直接拒绝写入（默认只提醒）。', control: 'switch', unit: '', values: '' },
  { id: 'strictCrossSource', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Refuse writes whose catalog entry resolves outside the family.', label: '引用外部内容即拒绝', hint: '技能引用了本插件之外的文件时拒绝写入。', control: 'switch', unit: '', values: '' },
  { id: 'citationPolicy', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Refuse a move that would leave a dangling reference, or verify it.', label: '引用检查方式', hint: '移动或合并技能时怎么处理引用：先检查／直接拒绝。', control: 'select', unit: '', values: 'verify|refuse', valueLabels: '先检查|直接拒绝' },
  { id: 'referenceRewrite', group: 'write-caps', tier: 'E2', authority: 'cordis', owner: 'tool-skill-manage', applies: 'none', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Re-home support files and rewrite references during a merge (plan or apply).' },
  { id: 'archiveRetention', group: 'write-caps', tier: 'E2', authority: 'cordis', owner: 'tool-skill-manage', applies: 'none', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Report expired archives, or prune them.' },
  { id: 'supportFileCharPolicy', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Warn about an oversize support file, or refuse the write.', label: '附带文件超限时', hint: '附带文件超出上限时：只提醒／拒绝写入。', control: 'select', unit: '', values: 'report|enforce', valueLabels: '只提醒|拒绝写入' },
  { id: 'memoryChars', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'memory-files', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Character budget the memory store enforces for MEMORY.md.', label: '记忆库上限', hint: '长期记忆文件（MEMORY.md）最多多少字符。', control: 'number', unit: '字符', values: '' },
  { id: 'userChars', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'memory-files', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Character budget the memory store enforces for USER.md.', label: '用户画像上限', hint: '用户画像文件（USER.md）最多多少字符。', control: 'number', unit: '字符', values: '' },
  { id: 'memoryEnabled', group: 'memory', tier: 'E2', authority: 'cordis', owner: 'tool-memory', applies: 'none', docAnchor: 'PARAMETERS.md#memory', summary: 'Register the memory tool and its prompt section at all (deployment switch).' },
  { id: 'entryPreviewChars', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'tool-memory', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Characters of one memory entry shown in a tool result preview.', label: '记忆预览长度', hint: '列表里每条记忆最多显示多少字符。', control: 'number', unit: '字符', values: '' },
  { id: 'addDatePrefix', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'memory-files', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Prefix stored memory entries with their date heading.', label: '记忆条目加日期', hint: '写入时在条目开头加上日期。', control: 'switch', unit: '', values: '' },
  { id: 'maxConsolidationFailures', group: 'memory', tier: 'E3', authority: 'cordis', owner: 'memory-files', applies: 'live', docAnchor: 'PARAMETERS.md#memory', summary: 'Consolidation failures one turn tolerates before the tool gives up.', label: '合并失败重试', hint: '合并记忆连续失败多少次后停止。', control: 'number', unit: '次', values: '' },
  { id: 'curatorIntervalHours', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Minimum hours between deterministic curation passes.', label: '自动整理间隔', hint: '两次自动整理之间至少间隔多少小时。', control: 'number', unit: '小时', values: '' },
  { id: 'staleAfterDays', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Inactive days before a skill counts as stale.', label: '多久没用算过时', hint: '技能连续多少天没被用到就算过时。', control: 'number', unit: '天', values: '' },
  { id: 'archiveAfterDays', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Inactive days before a stale skill is archived (must be >= staleAfterDays).', label: '过时后归档', hint: '过时技能再过多少天移入归档（不能小于上一项）。', control: 'number', unit: '天', values: '' },
  { id: 'qualityWarnStaleAfterDays', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Age at which a low quality score starts warning.', label: '质量偏低提醒', hint: '质量评分偏低时，从多少天开始提醒。', control: 'number', unit: '天', values: '' },
  { id: 'minIdleHours', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Idle hours required before an automatic curation pass runs.', label: '最少空闲时长', hint: '你至少多少小时没用，才运行自动整理。', control: 'number', unit: '小时', values: '' },
  { id: 'minIdleFailOpen', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Let the idle gate open when the activity probe is unavailable.', label: '检测不到活动也运行', hint: '无法判断你是否空闲时，仍然运行自动整理。', control: 'switch', unit: '', values: '' },
  { id: 'llmReview', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Enable the LLM nomination pass on top of the deterministic lifecycle.', label: '用模型挑选', hint: '在固定规则之外，再用模型挑一遍候选项。', control: 'switch', unit: '', values: '' },
  { id: 'curatorReviewMaxTokens', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Token budget of the curator LLM review.', label: '模型处理上限', hint: '每次用模型挑选时最多消耗多少 token。', control: 'number', unit: 'token', values: '' },
  { id: 'curatorReviewTimeoutMs', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Wall-clock bound of the curator LLM review.', label: '模型处理超时', hint: '一次模型挑选最长允许运行多久。', control: 'number', unit: '毫秒', values: '' },
  { id: 'healthSoftBodyChars', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Body character line the health view judges against.', label: '正文长度参考值', hint: '技能正文超过多少字符算偏长（只用于健康提示）。', control: 'number', unit: '字符', values: '' },
  { id: 'healthStampDensityPerKb', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Stamp density per KB that flags log-like content in a body.', label: '日志化判定阈值', hint: '每 KB 出现多少个时间标记，就判为「像日志」。', control: 'number', unit: '处/KB', values: '' },
  { id: 'healthChurnMinPatches', group: 'curator', tier: 'E3', authority: 'cordis', owner: 'evolution-curator', applies: 'live', docAnchor: 'PARAMETERS.md#curator', summary: 'Patches without a read that flag a write-ghost skill.', label: '只写不读判定次数', hint: '连续多少次改动都没有被读取，就判为「只写不读」。', control: 'number', unit: '处', values: '' },
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

/**
 * The settings namespace one owner package registers. The registry's map is the only
 * place a namespace is spelled: a package without an entry has no user layer, so a
 * missing entry must fail loud here instead of letting a package fall back to a
 * private constant that the registry never sees.
 * @param owner - owner package directory name (the map's key).
 * @returns the namespace that owner registers.
 * @throws when the owner has no entry in {@link PARAM_NAMESPACES}.
 */
export function paramNamespace(owner: string): string {
  const namespace = PARAM_NAMESPACES[owner]
  if (namespace === undefined) throw new Error('no settings namespace registered for owner `' + owner + '` (add it to PARAM_NAMESPACES)')
  return namespace
}

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
  /** Merge a patch into one namespace's user layer. A stale `expectedRevision`
   * rejects with the platform's SETTINGS_CONFLICT error. */
  update?(namespace: string, patch: object, expectedRevision?: number): Promise<void>
  describe?(options?: { redactSecrets?: boolean }): {
    ns: string
    /** Current resolved section (schema defaults < base < user). */
    value?: unknown
    /** Raw user section: a key's PRESENCE marks a user override. */
    user?: Record<string, unknown>
    /** Monotonic revision of that raw section; a write sends it back. */
    revision?: number
    /** Owner's declared effect timing. */
    applies?: 'live' | 'restart'
  }[]
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
