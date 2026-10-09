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
  { id: 'reviewSkillInterval', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Tool calls between skill-review injections: a turn advances by its tool-call count (a turn with none counts as one), or by 1 when the turn itself used a skill.', label: '技能检查间隔', hint: '每累计多少次工具调用检查一次技能：一轮按该轮工具调用数累加（一轮没有工具调用也算 1 次），本轮本身用到技能则只算 1 次。', control: 'number', unit: '次', values: '' },
  { id: 'reviewMemoryInterval', group: 'review', tier: 'E3', authority: 'cordis', owner: 'evolution-review', applies: 'live', docAnchor: 'PARAMETERS.md#review', summary: 'Tool calls between memory-review injections: a turn advances by its tool-call count (a turn with none counts as one), or by 1 when the turn itself touched memory.', label: '记忆检查间隔', hint: '每累计多少次工具调用检查一次记忆：一轮按该轮工具调用数累加（一轮没有工具调用也算 1 次），本轮本身用到记忆则只算 1 次。', control: 'number', unit: '次', values: '' },
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
  { id: 'skillVersionKeep', group: 'write-caps', tier: 'E2', authority: 'cordis', owner: 'tool-skill-manage', applies: 'none', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Content versions retained per skill; older ones leave the index. Their stored blobs stay on disk — no automatic sweep exists yet, so a long-lived library grows by the distinct bodies it has written.' },
  { id: 'supportFileCharPolicy', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Warn about an oversize support file, or refuse the write.', label: '附带文件超限时', hint: '附带文件超出上限时：只提醒／拒绝写入。', control: 'select', unit: '', values: 'report|enforce', valueLabels: '只提醒|拒绝写入' },
  { id: 'skillWriteConfirm', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'What the one confirmation before a create or a bare delete does: write straight through, wait for an answer, or cancel the write when nobody answers within the timeout.', label: '写入前是否确认', hint: '新建或删除技能前要不要问你：直接写入／一直等你回答／超时未答就取消这次写入。', control: 'select', unit: '', values: 'auto|ask|timeout', valueLabels: '不弹窗直接写入|一直等待回答|超时自动取消' },
  { id: 'skillWriteConfirmTimeoutSeconds', group: 'write-caps', tier: 'E3', authority: 'cordis', owner: 'tool-skill-manage', applies: 'live', docAnchor: 'PARAMETERS.md#write-caps', summary: 'Seconds the confirmation waits for an answer in timeout mode before the write is cancelled.', label: '确认等待秒数', hint: '选「超时自动取消」时，等多少秒没人回答就取消这次写入。', control: 'number', unit: '秒', values: '' },
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
  { id: 'install.mode', group: 'deployment', tier: 'E4', authority: 'install', owner: 'scripts', applies: 'restart', docAnchor: 'PARAMETERS.md#deployment', summary: 'Install target plane (values host / agent / layered / oneclick; the `layered` form uses the generated preset, the others mount the bundle at profile root).' },
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
 * The rows whose settings namespace CHANGED with the platform-line move (G3): the
 * platform keys a settings section by the Loader entry id now, while 0.1.x let each
 * plugin register a free-form namespace — this table is the difference, DERIVED from
 * {@link PARAM_NAMESPACES} so freezing a row id renames it in one place.
 *
 * It is the migration's TARGET (`rowId`) and its SOURCE (`namespace`, the section a
 * stored value sits in). Rows whose two names already agree are absent: there is
 * nothing to move for them.
 */
export const NAMESPACE_MIGRATIONS: readonly { readonly namespace: string; readonly rowId: string }[] = Object.freeze(
  Object.entries(PARAM_NAMESPACES)
    .filter(([owner, namespace]) => namespace !== owner)
    .map(([owner, namespace]) => Object.freeze({ namespace, rowId: owner })),
)

/**
 * The LEGACY settings namespace one owner package used to register through the family's
 * own seam (0.1.x). It is no longer what the platform calls the section: the platform
 * derives a settings namespace from the Loader entry id, and this registry's `owner` field
 * IS that row id, so a live lookup uses {@link paramRowId}. What remains here is the
 * migration SOURCE (G3 moves a user layer out of this string and into the row id).
 * @param owner - owner package directory name (the map's key).
 * @returns the legacy namespace that owner registered.
 * @throws when the owner has no entry in {@link PARAM_NAMESPACES}.
 */
export function paramNamespace(owner: string): string {
  const namespace = PARAM_NAMESPACES[owner]
  if (namespace === undefined) throw new Error('no settings namespace registered for owner `' + owner + '` (add it to PARAM_NAMESPACES)')
  return namespace
}

/**
 * The settings id one row's user layer lives under, or undefined when the owner publishes
 * no user layer at all (a deployment-only row: its knobs are E2 and never reach a settings
 * section). The platform derives a settings namespace from the Loader entry id and reports
 * it in `settings.describe()` / `configForms.get(entryId)`, and an owner package's row id is
 * its own name — spelled the same in every bundle patch.
 *
 * This is the id to LOOK UP with; {@link paramNamespace} keeps the legacy string the 0.1.x
 * seam registered, which is the G3 migration source and never a live lookup key.
 * @param owner - owner package directory name (the row id).
 * @returns the entry id the platform reports for that row, or undefined for a row without
 *   a user layer.
 */
export function paramSettingsId(owner: string): string | undefined {
  return PARAM_NAMESPACES[owner] === undefined ? undefined : owner
}

/**
 * The settings id of a row that MUST have a user layer (an owner reading its own section).
 * @param owner - owner package directory name (the row id).
 * @returns the entry id the platform reports for that row.
 * @throws when the owner publishes no user layer.
 */
export function paramRowId(owner: string): string {
  const id = paramSettingsId(owner)
  if (id === undefined) throw new Error('no settings namespace registered for owner `' + owner + '` (add it to PARAM_NAMESPACES)')
  return id
}

/**
 * Structural view of the platform settings provider: only the members the family
 * still uses are named.
 *
 * G1 removed the family's own settings seam (`installParamSection`): a volatile row
 * field carries the user layer by itself, so what remains is the WRITE face
 * (`update`) and the one read the precedence rule needs — `describe()`, for the KEY
 * NAMES the user set. A value is never read from here. Declared locally so this module
 * keeps its zero-import, zero-dependency shape.
 */
export interface SettingsProviderLike {
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
