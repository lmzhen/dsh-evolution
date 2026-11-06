/**
 * Host-side message catalog shared by tool results and user-facing errors.
 *
 * Tool results and error copy are model- and user-facing text, so they need the same
 * translatability the client dictionaries already have — but they are produced in the
 * HOST half, where the platform locale seat does not exist. This module is the one
 * resolver: packages register a table of `source text → translations` and call
 * {@link tr} with the source string as the key (gettext shape: the Chinese text stays
 * the authoring source, translators fill the `en` / `ja` columns).
 *
 * The active locale comes from the platform's durable locale preference
 * (`settings.locale.preference`), installed by the policy plugin. Without a provider
 * (unit tests, direct library use) the locale is `zh`, so every existing assertion
 * keeps reading the authored text.
 * @module @deepseek-ai/dsh-evolution-core
 */

/** Locales this family can render host copy in. */
export type HostLocale = 'zh' | 'en' | 'ja'

/**
 * One package's translation table. Keys are the Chinese source strings used at the
 * call sites; a value of `''` (or a missing key) means "not translated yet".
 */
export interface HostMessages {
  readonly en?: Readonly<Record<string, string>>
  readonly ja?: Readonly<Record<string, string>>
}

const tables: HostMessages[] = []
let localeProvider: (() => HostLocale) | null = null
let cachedLocale: { readonly at: number; readonly value: HostLocale } | null = null

/**
 * Register one package's translation table. Tables are matched by identity, so a
 * re-registration (HMR, repeated module evaluation) is a no-op.
 * @param table - the package's `en` / `ja` columns.
 * @returns a disposer that removes the table again.
 */
export function registerHostMessages(table: HostMessages): () => void {
  if (!tables.includes(table)) tables.push(table)
  return () => {
    const index = tables.indexOf(table)
    if (index >= 0) tables.splice(index, 1)
  }
}

/**
 * Install the process-wide locale resolver (the policy plugin reads the platform
 * settings). Passing `null` restores the authored `zh` default.
 * @param provider - returns the active locale, or null to detach.
 * @returns a disposer restoring the previous provider.
 */
export function installHostLocale(provider: (() => HostLocale) | null): () => void {
  const previous = localeProvider
  localeProvider = provider
  cachedLocale = null
  return () => {
    localeProvider = previous
    cachedLocale = null
  }
}

/**
 * Resolve the active host locale. The provider is sampled at most once per second:
 * `settings.describe()` walks every entry, and tool results can be produced in bursts.
 * @returns the locale the host copy should render in.
 */
export function hostLocale(): HostLocale {
  if (localeProvider === null) return 'zh'
  const now = Date.now()
  if (cachedLocale !== null && now - cachedLocale.at < 1000) return cachedLocale.value
  let value: HostLocale = 'zh'
  try {
    const resolved = localeProvider()
    value = resolved === 'en' || resolved === 'ja' ? resolved : 'zh'
  } catch {
    value = 'zh'
  }
  cachedLocale = { at: now, value }
  return value
}

/**
 * Read the platform locale preference from the settings service, the way the browser
 * half does: the durable `locale` namespace's `preference` field. Absence (the browser
 * decides) has no host-side answer, so it falls back to `zh` — the authored language.
 * @param reader - something with the host `get(name)` (a cordis Context).
 * @returns the preference as a host locale.
 */
export function localeFromSettings(reader: { get(name: string): unknown }): HostLocale {
  try {
    const settings = reader.get('settings') as {
      describe?: () => ReadonlyArray<{ ns?: string; user?: { preference?: unknown } }>
    } | undefined
    const entry = settings?.describe?.().find(item => item?.ns === 'locale')
    const preference = entry?.user?.preference
    return preference === 'en' || preference === 'ja' ? preference : 'zh'
  } catch {
    return 'zh'
  }
}

/**
 * Translate one piece of host copy through the registered tables, falling back key by
 * key: active locale → English → the authored source text.
 * @param source - the Chinese source string (the table key).
 * @param params - values for `{name}` slots; an unknown slot is left standing.
 * @returns the translated copy, or the source when nothing is registered.
 */
export function tr(source: string, params?: Readonly<Record<string, string | number>>): string {
  return trIn(hostLocale(), source, params)
}

/**
 * Translate in an explicit locale (tests and locale-specific assertions). The same
 * fallback chain applies: requested locale → English → source.
 * @param locale - the locale to render in.
 * @param source - the Chinese source string.
 * @param params - values for `{name}` slots.
 * @returns the translated copy, or the source when nothing is registered.
 */
export function trIn(locale: HostLocale, source: string, params?: Readonly<Record<string, string | number>>): string {
  const lookup = (key: 'en' | 'ja'): string | undefined => {
    for (const table of tables) {
      const value = table[key]?.[source]
      if (typeof value === 'string' && value !== '') return value
    }
    return undefined
  }
  let text = source
  if (locale === 'ja') text = lookup('ja') ?? lookup('en') ?? source
  else if (locale === 'en') text = lookup('en') ?? source
  return fill(text, params)
}

/**
 * Fill one template's `{slot}` placeholders. A missing value is left standing so a
 * mistake cannot print `undefined` into a tool result.
 * @param template - the resolved copy.
 * @param params - substitution values.
 * @returns the filled copy.
 */
function fill(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
}

/**
 * Core's translation column for tool-result and error copy. Keys are the Chinese
 * source strings used at the call sites; `''` means "not translated yet" (the
 * resolver falls back to the source text). Translators fill the `en` / `ja` values;
 * the gate `verify-host-messages.mjs` keeps the key sets identical to the call sites.
 */
export const CORE_MESSAGES: HostMessages = {
  en: {
  ' 已把备份保存到 {name}。': ' Backup saved to {name}.',
  ' 等': ' etc.',
  ' （警告：{warnings}）': ' (warning: {warnings})',
  ' （警告：写入已落盘，但目录 fsync 失败 —— 持久性未确认：{warnings})': ' (warning: write landed on disk, but directory fsync failed — durability unconfirmed: {warnings})',
  '.archive 里没有「{name}」对应的 frontmatter 名，但有 {count} 个名字相似的归档项：{items}。': 'No archived entry in .archive has frontmatter name "{name}", but {count} similarly named archived item(s) exist: {items}.',
  'Frontmatter 字段 {fields} 必须是字符串：平台技能目录会把这种字段当作缺失，并忽略整个文件。请写成纯文本，或用双引号包住取值以保持字面内容。': 'Frontmatter field(s) {fields} must be strings: the platform skill catalog treats non-string fields as missing and ignores the entire file. Write plain text or wrap the value in double quotes to preserve literal content.',
  'Frontmatter 必须包含 description 字段。': 'Frontmatter must include a description field.',
  'Frontmatter 必须包含 name 字段。': 'Frontmatter must include a name field.',
  'Frontmatter 里的 name「{name}」与目标技能「{target}」不一致。': 'Frontmatter name "{name}" does not match target skill "{target}".',
  'SKILL.md 内容超过 {limit} 个字符。{hint}': 'SKILL.md content exceeds {limit} characters.{hint}',
  'SKILL.md 必须以 `---` 行开头，用另一个完全相同的 `---` 行结束 frontmatter（只容忍结尾的 `\\r`），并在其下包含正文。': 'SKILL.md must start with a `---` line, close frontmatter with an identical `---` line (only a trailing `\\r` is tolerated), and include a body below it.',
  'SKILL.md 没有有效的 frontmatter；拒绝重构。': 'SKILL.md has no valid frontmatter; restructure refused.',
  'absorbed_into 不能是正在归档的技能本身（不能吸收到自己）。': 'absorbed_into cannot be the skill being archived itself (cannot be absorbed into itself).',
  'description 超过 {limit} 个字符。': 'description exceeds {limit} characters.',
  'external support 不是普通文件：{path}': 'external support is not a regular file: {path}',
  'external support 文件不存在：{path}': 'external support file does not exist: {path}',
  'external support 根目录不可读：{path}': 'external support root directory is unreadable: {path}',
  'external support 目标冲突：{path}': 'external support target conflict: {path}',
  'external support 超过单文件上限：{path}': 'external support exceeds single-file size limit: {path}',
  'external support 超过总上限：{path}': 'external support exceeds total size limit: {path}',
  'external support 越界：{path}': 'external support path out of bounds: {path}',
  'extract 的每一项都必须是对象。': 'Each item in extract must be an object.',
  'extract 的每一项都需要 heading 与 to_skill。': 'Each item in extract requires heading and to_skill.',
  'extract 需要 name 与至少一个 extract 项。': 'extract requires name and at least one extract item.',
  'hermes-managed 标记已落盘，但其目录 fsync 失败 —— 持久性未确认：{cause}': 'hermes-managed marker landed on disk, but its directory fsync failed — durability unconfirmed: {cause}',
  'operations 列表为空。': 'The operations list is empty.',
  'outcome 只能是 extract 或 mixed；owner-gap 由缺失 target 的路径自动决定。': 'outcome must be extract or mixed; owner-gap is determined automatically when target is absent.',
  'row `{row}` 在本组合中不提供服务': 'row `{row}` does not provide a service in this composition',
  'row `{row}` 没有这个参数': 'row `{row}` does not have this parameter',
  'source 与 target 不能相同。': 'source and target must not be the same.',
  'source 没有有效 frontmatter': 'source has no valid frontmatter',
  'target 已有同名 heading「{heading}」。': 'target already has a heading named "{heading}".',
  'target 没有有效 frontmatter': 'target has no valid frontmatter',
  'to_heading 暂不支持改名；G3 要求 heading 与 to_heading 相同。': 'Renaming via to_heading is not supported yet; G3 requires heading and to_heading to be identical.',
  '{count} 条记忆超过了配置的 {target}CharLimit（{limit}）；它们是在更高上限下写入的。请提高上限或删除条目 —— 删除类操作仍然可用。': '{count} memory entr(ies) exceed the configured {target}CharLimit ({limit}); they were written under a higher limit. Increase the limit or remove entries — removal operations remain available.',
  '{path}（单元前字节读不到：blob {hash}）': '{path} (pre-unit bytes unreadable: blob {hash})',
  '{path}（单元里没有该路径的 after 条目）': '{path} (unit has no after entry for this path)',
  '{path}（盘上字节已变，回退会覆盖别人的改动）': '{path} (on-disk bytes changed; reverting would overwrite subsequent edits)',
  '{path}（盘上文件不存在）': '{path} (file does not exist on disk)',
  '{path}：{message} —— 撤销未完成（已回退：{done}）。': '{path}: {message} — undo incomplete (reverted so far: {done}).',
  '{skill}（归档成员不在 .archive）': '{skill} (archived member is not in .archive)',
  '{skill}（归档成员缺少归档路径）': '{skill} (archived member is missing its archive path)',
  '{skill}（成员技能不在活动树或归档里）': '{skill} (member skill is neither in the active tree nor in .archive)',
  '{skill}：SKILL.md 缺少单元前字节': '{skill}: SKILL.md is missing pre-unit bytes',
  '一次 extract 只能有一个 to_skill；多目标请分多次调用。': 'A single extract call may specify only one to_skill; make separate calls for multiple targets.',
  '不允许路径穿越。': 'Path traversal is not allowed.',
  '不支持的文件名「{part}」：.corrupt/.tmp 后缀由状态与 IO 协议保留。': 'Unsupported filename "{part}": the .corrupt/.tmp suffixes are reserved by the state and IO protocols.',
  '不支持的文件名「{part}」：请只用小写字母、数字、点、连字符和下划线（首字符须为字母或数字）。': 'Unsupported filename "{part}": use only lowercase letters, digits, dots, hyphens, and underscores (must start with a letter or digit).',
  '不支持的文件名「{part}」：这是 Windows 保留设备名。': 'Unsupported filename "{part}": this is a reserved Windows device name.',
  '从 .archive 恢复「{name}」失败：{reason}': 'Failed to restore "{name}" from .archive: {reason}',
  '修补后的内容超过 {limit} 个字符。{hint}': 'Patched content exceeds {limit} characters.{hint}',
  '修补后的文件内容超过 {limit} 个字符。{hint}': 'Patched file content exceeds {limit} characters.{hint}',
  '修补后的文件超过 {limit} 字节。': 'Patched file exceeds {limit} bytes.',
  '候选 owner：{names}。': 'Candidate owners: {names}.',
  '内容不能为空。': 'Content must not be empty.',
  '内部错误：写事务没有调用任务；未执行任何写入': 'Internal error: write transaction has no caller task; nothing was written',
  '内部错误：删除事务没有调用任务；没有删除任何东西': 'Internal error: delete transaction has no caller task; nothing was deleted',
  '内部错误：记忆写事务没有调用任务；未执行任何写入': 'Internal error: memory write transaction has no caller task; nothing was written',
  '写入已落盘，但目录 fsync 失败 —— 持久性未确认：{cause}': 'Write landed on disk, but directory fsync failed — durability unconfirmed: {cause}',
  '写入超过 {limit} 字节：{path}': 'Write exceeds {limit} bytes: {path}',
  '创建': 'Create',
  '创建技能 "{name}"？会在家族目录树里新建一个技能目录。': 'Create skill "{name}"? This will create a new skill directory in the family skill tree.',
  '创建过程中技能「{name}」被并发归档；残留标记已移除：等搬运完成后重试一次。': 'Skill "{name}" was archived concurrently during creation; residual markers were removed: wait for the move to finish and retry once.',
  '删除': 'Delete',
  '删除技能 "{name}"？它会被归档到 .archive 并离开目录。': 'Delete skill "{name}"? It will be archived to .archive and removed from the catalog.',
  '功能：{description}': 'Function: {description}',
  '参与合并的技能支撑文件在决策之后被改过；拒绝提交（未写入任何内容）。': 'Supporting files of a skill participating in the merge were modified after the decision; commit refused (nothing was written).',
  '取消': 'Cancel',
  '只有前台（用户或主智能体）可以固定或取消固定技能。': 'Only the foreground (user or main agent) can pin or unpin a skill.',
  '合并失败（{reason}）；已回滚，但以下未回滚：{stuck}：它们仍在 .archive 里，请用 /evolution skill restore 恢复。': 'Merge failed ({reason}); rolled back, except for: {stuck} — they remain in .archive; restore them with /evolution skill restore.',
  '合并失败，已回滚：{reason}': 'Merge failed and was rolled back: {reason}',
  '合并至少需要一个互不相同的来源技能。': 'Merge requires at least one distinct source skill.',
  '合并被拒绝：{reason} 会被落下。请改用 mode:\'reference\'，或直接归档整个包。{note}': 'Merge refused: {reason} would be left behind. Use mode:\'reference\' instead, or archive the entire package.{note}',
  '合并被拒绝：来源技能「{source}」的正文引用了会被落下的支撑文件（{refs}）：请改为归档整个包。{note}': 'Merge refused: the body of source skill "{source}" cites supporting files that would be left behind ({refs}): archive the entire package instead.{note}',
  '固定过程中技能「{name}」被并发归档；残留标记已移除：等搬运完成后重试。': 'Skill "{name}" was archived concurrently while being pinned; residual markers were removed: wait for the move to finish and retry.',
  '在「{name}/{path}」里找不到 old_string（或 replaceAll 的模糊匹配预算已用尽）。整篇重写请改用 update。': 'Could not find old_string in "{name}/{path}" (or the fuzzy-match budget for replaceAll was exhausted). Use update for a full rewrite.',
  '在任何清理之前就拒绝了快照恢复：生成回滚前快照失败（{reason}）—— 活动目录树未改变。请解决快照写入失败后重试。': 'Snapshot restore refused before any cleanup: failed to create the pre-rollback snapshot ({reason}) — the active skill tree is unchanged. Resolve the snapshot write failure and retry.',
  '在任何清理之前就拒绝了快照恢复：读取快照清单或附属文件失败（{reason}）—— 活动目录树未改变。请解决读取失败后重试。': 'Snapshot restore refused before any cleanup: failed to read the snapshot manifest or ancillary files ({reason}) — the active skill tree is unchanged. Resolve the read failure and retry.',
  '在任何清理之前就拒绝了快照恢复； 活动目录树未改变。\n- 目标：{reason}\n- 回滚前快照：{rollback}\n请解决原因（有存活的技能写入，或快照不完整）后重试 —— 无需手动抢救。': 'Snapshot restore refused before any cleanup; the active skill tree is unchanged.\n- Target: {reason}\n- Pre-rollback snapshot: {rollback}\nResolve the cause (an active skill write or an incomplete snapshot) and retry — no manual recovery is needed.',
  '复制成功，但源目录删不掉（{reason}），且复制出的目录树也无法回滚 —— 该目录树现在同时存在于两处；请手动清理': 'Copy succeeded, but the source directory could not be removed ({reason}) and the copied directory tree could not be rolled back — the tree now exists in both locations; clean it up manually',
  '复制成功，但源目录删不掉（{reason}）；已回滚复制出的目录树': 'Copy succeeded, but the source directory could not be removed ({reason}); the copied directory tree was rolled back',
  '已从 {path} 恢复技能目录树': 'Restored skill directory tree from {path}',
  '已创建技能「{name}」。{warnings}': 'Created skill "{name}".{warnings}',
  '已应用 {count} 个操作。{hint}': 'Applied {count} operation(s).{hint}',
  '已把 {sources} 合并进「{target}」。': 'Merged {sources} into "{target}".',
  '已按单元撤销：{list}。': 'Undone by unit: {list}.',
  '已添加条目。{hint}': 'Entry added.{hint}',
  '已记录的内容版本数：{versions}': 'Recorded content versions: {versions}',
  '已重构「{name}」：把 {count} 个章节搬到 references/。': 'Restructured "{name}": moved {count} section(s) to references/.',
  '建议拆成更小的 SKILL.md，把支撑文件放进 references/ 或 templates/。': 'Consider splitting into a smaller SKILL.md and placing supporting files in references/ or templates/.',
  '归档新目标「{skill}」失败：{message} —— 撤销未完成（已回退：{done}）。': 'Failed to archive new target "{skill}": {message} — undo incomplete (reverted so far: {done}).',
  '归档项「{name}」是符号链接；拒绝恢复。': 'Archived entry "{name}" is a symbolic link; restore refused.',
  '当前没有可用 owner candidate（描述为空或被排除）。': 'No owner candidates are currently available (descriptions are empty or excluded).',
  '当前没有可用快照': 'No snapshots are currently available',
  '快照恢复失败（{reason}），且回滚前快照的恢复也失败（{rollback}）。请手动抢救：{preRollback}（回滚前）、{target}（目标）。': 'Snapshot restore failed ({reason}), and restoring the pre-rollback snapshot also failed ({rollback}). Recover manually: {preRollback} (pre-rollback), {target} (target).',
  '快照恢复失败（{reason}）；活动目录树已回滚到回滚前的快照。': 'Snapshot restore failed ({reason}); the active skill tree was rolled back to the pre-rollback snapshot.',
  '快照目录读不出来（{reason}）': 'Snapshot directory is unreadable ({reason})',
  '恢复「{skill}」失败：{message} —— 撤销未完成（已回退：{done}）。': 'Failed to restore "{skill}": {message} — undo incomplete (reverted so far: {done}).',
  '批处理结果（{total} 字符）超过 {limit} 上限。请在同一个批里再删除或缩短一些条目。': 'Batch result ({total} chars) exceeds the {limit}-char limit. Remove or shorten more entries in the same batch.',
  '技能 "{name}" 在读取之后被改动过；为避免覆盖更新的内容，本次写入被拒绝。': 'Skill "{name}" was modified after it was read; to avoid overwriting newer content, this write was refused.',
  '技能 "{name}" 已取消固定。': 'Skill "{name}" has been unpinned.',
  '技能 "{name}" 已固定：免受删除、后台复核与生命周期影响。': 'Skill "{name}" has been pinned: exempt from deletion, background review, and lifecycle transitions.',
  '技能 "{name}" 的支撑文件 "{path}" 在读取之后被改动过；为避免覆盖更新的内容，本次写入被拒绝。': 'Supporting file "{path}" of skill "{name}" was modified after it was read; to avoid overwriting newer content, this write was refused.',
  '技能「{name}」不在 .archive 里。': 'Skill "{name}" is not in .archive.',
  '技能「{name}」不存在。': 'Skill "{name}" does not exist.',
  '技能「{name}」与已存在的大小写变体目录「{entry}」冲突（技能名只允许小写）：请重命名其中一个。': 'Skill "{name}" conflicts with existing case-variant directory "{entry}" (skill names allow lowercase only): rename one of them.',
  '技能「{name}」受保护（{protection}）。': 'Skill "{name}" is protected ({protection}).',
  '技能「{name}」已从 .archive 恢复。': 'Skill "{name}" has been restored from .archive.',
  '技能「{name}」已修补（{path}）。{note}{advisory}': 'Skill "{name}" patched ({path}).{note}{advisory}',
  '技能「{name}」已存在。': 'Skill "{name}" already exists.',
  '技能「{name}」已存在于当前根目录；拒绝覆盖。': 'Skill "{name}" already exists in the current root directory; overwrite refused.',
  '技能「{name}」已归档到 .archive。': 'Skill "{name}" has been archived to .archive.',
  '技能「{name}」已更新。{warning}{retention}': 'Skill "{name}" has been updated.{warning}{retention}',
  '技能「{name}」已被固定。': 'Skill "{name}" is already pinned.',
  '技能「{name}」归档失败：{reason}。': 'Failed to archive skill "{name}": {reason}.',
  '技能「{name}」是符号链接；拒绝归档。': 'Skill "{name}" is a symbolic link; archive refused.',
  '技能「{name}」未变更：old_string 与替换内容相同（{path}），未写入。': 'Skill "{name}" unchanged: old_string and replacement content are identical ({path}); nothing was written.',
  '技能「{name}」未变更：提供的内容与当前文件一致，未写入。': 'Skill "{name}" unchanged: provided content matches the current file; nothing was written.',
  '技能「{name}」未被固定，无需处理。': 'Skill "{name}" is not pinned; no action needed.',
  '技能「{name}」没有可读取的正文。': 'Skill "{name}" has no readable body.',
  '技能「{name}」没有有效的 frontmatter；拒绝合并。': 'Skill "{name}" has no valid frontmatter; merge refused.',
  '技能「{name}」没有有效的 frontmatter；拒绝降级。': 'Skill "{name}" has no valid frontmatter; demotion refused.',
  '技能「{name}」的 frontmatter 无法自动修复：{issue}：请用双引号包住取值后重试。': 'Frontmatter of skill "{name}" cannot be auto-repaired: {issue}: wrap the value in double quotes and retry.',
  '技能「{variant}」（同名、仅大小写不同）已存在于当前根目录；把「{name}」恢复到它旁边会造成含义不清的重复：请恢复为「{variant}」，或先移除该变体。': 'Skill "{variant}" (same name, differing only in case) already exists in the current root directory; restoring "{name}" alongside it would create an ambiguous duplicate: restore as "{variant}" or remove that variant first.',
  '技能名「{name}」不合法：请只用小写字母、数字和连字符。': 'Invalid skill name "{name}": use only lowercase letters, digits, and hyphens.',
  '技能名「{name}」不合法：请只用小写字母、数字和连字符（不超过 {limit} 个）。': 'Invalid skill name "{name}": use only lowercase letters, digits, and hyphens (at most {limit} characters).',
  '技能名超过 {limit} 个字符。': 'Skill name exceeds {limit} characters.',
  '技能目录「{name}」已存在于当前根目录，但没有 SKILL.md；恢复前请先移除或修复它。': 'Skill directory "{name}" already exists in the current root directory without a SKILL.md; remove or repair it before restoring.',
  '拒绝快照恢复：快照目录读不出来（{reason}）—— 未做任何改动。': 'Snapshot restore refused: snapshot directory is unreadable ({reason}) — no changes were made.',
  '拒绝目录树变更：删除目标不存在 {path}': 'Directory tree mutation refused: deletion target does not exist {path}',
  '拒绝目录树变更：无法安全预读 {path}（{cause}）；未执行任何写入': 'Directory tree mutation refused: cannot safely pre-read {path} ({cause}); nothing was written',
  '描述为 {chars}/60 个字符 —— 在作者规范上限之内。': 'Description is {chars}/60 characters — within the authoring standard limit.',
  '描述为 {chars}/60 个字符 —— 超过 60 字符的作者规范上限（Hermes 标准；技能目录会按平台配置的上限截断）。': 'Description is {chars}/60 characters — exceeds the 60-character authoring standard limit (Hermes standard; the skill catalog truncates at the platform-configured limit).',
  '描述里含冒号 —— 请用双引号把整个取值包起来。': 'Description contains a colon — wrap the entire value in double quotes.',
  '提取失败：{errors}': 'Extraction failed: {errors}',
  '提取被拒绝：external support 缺少已验证的内容 {path}': 'Extraction refused: external support is missing verified content {path}',
  '提取被拒绝：external target 不安全 {path}': 'Extraction refused: external target is unsafe {path}',
  '提取被拒绝：owner-gap 不是写操作。': 'Extraction refused: owner-gap is not a write operation.',
  '提取被拒绝：source 与 target 相同。': 'Extraction refused: source and target are identical.',
  '提取被拒绝：source/target 在计划之后发生了变化；请重新计划。': 'Extraction refused: source/target changed after planning; re-plan first.',
  '提取被拒绝：support closure 存在 unresolved/dangling。': 'Extraction refused: support closure contains unresolved or dangling references.',
  '提取被拒绝：support 文件不存在 {path}': 'Extraction refused: support file does not exist {path}',
  '提取被拒绝：target 不在技能库中。': 'Extraction refused: target is not in the skill library.',
  '提取被拒绝：target 不存在；owner-gap 不自动 create。': 'Extraction refused: target does not exist; owner-gap does not auto-create.',
  '提取被拒绝：target 不是家族管理的技能。': 'Extraction refused: target is not a family-managed skill.',
  '提取被拒绝：{message}': 'Extraction refused: {message}',
  '提取被拒绝：待删除 support 不存在 {path}': 'Extraction refused: support file to delete does not exist {path}',
  '提取被拒绝：没有 part。': 'Extraction refused: no parts specified.',
  '支撑文件「{path}」已从「{name}」移除。': 'Supporting file "{path}" has been removed from "{name}".',
  '支撑文件「{path}」已写入「{name}」。{advisory}{warning}': 'Supporting file "{path}" has been written to "{name}".{advisory}{warning}',
  '支撑文件「{path}」未变更：提供的内容与当前文件一致，未写入。': 'Supporting file "{path}" unchanged: provided content matches the current file; nothing was written.',
  '支撑文件「{path}」的内容超过 {limit} 个字符。{hint}': 'Content of supporting file "{path}" exceeds {limit} characters.{hint}',
  '支撑文件列表不可读；拒绝在不确定的闭包上提取。': 'Supporting file list is unreadable; refusing to extract over an uncertain closure.',
  '支撑文件超过 {limit} 字节。': 'Supporting file exceeds {limit} bytes.',
  '支撑文件超过 {limit} 字节：{path}': 'Supporting file exceeds {limit} bytes: {path}',
  '支撑文件重复：{path}': 'Duplicate supporting file: {path}',
  '整单元撤销未开始（零写）—— 预检未通过：{refusals}。修好后可重试。': 'Whole-unit undo did not start (zero writes) — preflight check failed: {refusals}. Fix the issues and retry.',
  '文件「{path}」不在技能「{name}」里。': 'File "{path}" is not in skill "{name}".',
  '文件不存在：{path}': 'File does not exist: {path}',
  '新内容保留了上一版正文的 {kept}%（{after}／{before} 字符）；被替换的版本已保留在该技能的历史里。': 'New content retains {kept}% of the previous body ({after}/{before} characters); the replaced version is preserved in the skill\'s history.',
  '无': 'none',
  '无法检查技能「{name}」是否与大小写变体冲突：列出 {root} 失败（{cause}）。拒绝创建 —— 仅大小写不同的第二个目录在跨平台时无法撤销。': 'Cannot check whether skill "{name}" conflicts with a case variant: listing {root} failed ({cause}). Creation refused — a second directory differing only in case cannot be undone across platforms.',
  '无法检查技能「{name}」是否有写入方（有一个支撑目录列不出来）：请重试归档。': 'Cannot check whether skill "{name}" has active writers (a supporting directory could not be listed): retry archiving.',
  '无法检查技能「{name}」是否有写入方（有一个支撑目录列不出来）：请重试恢复。': 'Cannot check whether skill "{name}" has active writers (a supporting directory could not be listed): retry restoring.',
  '无法读取技能 "{name}" 以校验暂存内容。': 'Cannot read skill "{name}" to validate staged content.',
  '无法读取技能 "{name}" 的支撑文件 "{path}" 以校验暂存内容。': 'Cannot read supporting file "{path}" of skill "{name}" to validate staged content.',
  '最新快照 {path}': 'latest snapshot {path}',
  '未知': 'unknown',
  '本轮记忆整理已失败 {count} 次。请停止重试记忆调用，继续处理用户的任务。{preview}': 'Memory curation has failed {count} time(s) in this turn. Stop retrying memory calls and continue with the user\'s task.{preview}',
  '来源技能「{source}」不存在。': 'Source skill "{source}" does not exist.',
  '来源技能「{source}」在归档前被改过': 'Source skill "{source}" was modified before archiving',
  '来源技能「{source}」在计划之后被改过；拒绝提交（未写入任何内容）。': 'Source skill "{source}" was modified after planning; commit refused (nothing was written).',
  '来源技能「{source}」是受保护的内置技能。': 'Source skill "{source}" is a protected built-in skill.',
  '来源技能「{source}」的内容在决策之后被改过；拒绝提交（未写入任何内容）。': 'Content of source skill "{source}" was modified after the decision; commit refused (nothing was written).',
  '来源技能「{source}」缺少计划字节；拒绝提交。': 'Source skill "{source}" is missing planned bytes; commit refused.',
  '检测到记忆文件被外部改动。{suffix} 请先处理该漂移再重试。': 'External modification to the memory file detected.{suffix} Resolve this drift before retrying.',
  '正文引用了未提供的支撑文件「{ref}」；拒绝提交。': 'The body cites an unprovided supporting file "{ref}"; commit refused.',
  '每次重构搬移都必须是带 heading 的对象。': 'Each restructure move must be an object with a heading.',
  '每次重构搬移都需要非空的 heading。': 'Each restructure move requires a non-empty heading.',
  '没有可用的技能归档。': 'No skill archives are available.',
  '没有可用的技能快照。': 'No skill snapshots are available.',
  '添加该条目会超过 {limit} 字符上限。请先合并或删除过期条目，再重试。': 'Adding this entry would exceed the {limit}-character limit. Consolidate or remove stale entries first, then retry.',
  '清单读不出来或缺失（孤儿快照）': 'Manifest is unreadable or missing (orphan snapshot)',
  '目录树变更为空。': 'Directory tree mutation is empty.',
  '目录树变更声明了重复的根「{name}」。': 'Directory tree mutation declares duplicate root "{name}".',
  '目录树变更失败，已回滚：{reason}': 'Directory tree mutation failed and was rolled back: {reason}',
  '目录树变更失败：{reason}。回滚无法恢复 {stuck}：可恢复性由当前快照决定：{availability} —— 若上面不是「最新快照」，请重新应用这次变更。': 'Directory tree mutation failed: {reason}. Rollback could not restore {stuck}: recoverability depends on the current snapshot: {availability} — if the above is not "latest snapshot", re-apply this mutation.',
  '目录树变更的 primary skill「{name}」不在 roots 中。': 'Primary skill "{name}" of the directory tree mutation is not in roots.',
  '目标「{name}」不是可用的 owner candidate（描述为空或已排除）；owner-gap，不自动 create。': 'Target "{name}" is not an available owner candidate (description is empty or excluded); owner-gap does not auto-create.',
  '目标「{name}」不是家族 managed 技能；拒绝把可复用部分写进不受管目录。': 'Target "{name}" is not a family-managed skill; refusing to write reusable content into an unmanaged directory.',
  '目标「{name}」受保护（{protection}），拒绝提取。': 'Target "{name}" is protected ({protection}); extraction refused.',
  '目标「{name}」投影后约 {chars} 字符，超过 {limit} 上限；拒绝提取。': 'Target "{name}" would be approximately {chars} characters after projection, exceeding the {limit} limit; extraction refused.',
  '目标「{target}」描述与邻技能重叠：{overlaps}；请确认 owner 覆盖，提取仍可继续。': 'Description of target "{target}" overlaps with neighboring skill(s): {overlaps}; verify owner coverage (extraction may still proceed).',
  '目标不属于任何声明的技能根：{path}': 'Target does not belong to any declared skill root: {path}',
  '目标声明的技能「{skill}」不在 roots 中：{path}': 'Skill "{skill}" declared by target is not in roots: {path}',
  '目标技能「{name}」已超过 {limit} 字符，拒绝继续提取。': 'Target skill "{name}" already exceeds {limit} characters; refusing further extraction.',
  '目标技能「{target}」不存在。': 'Target skill "{target}" does not exist.',
  '目标技能「{target}」不是 family-managed；拒绝提交。': 'Target skill "{target}" is not family-managed; commit refused.',
  '目标技能「{target}」在计划之后被改过；拒绝提交（未写入任何内容）。': 'Target skill "{target}" was modified after planning; commit refused (nothing was written).',
  '目标技能「{target}」已存在。': 'Target skill "{target}" already exists.',
  '目标技能「{target}」已被固定；拒绝提交。': 'Target skill "{target}" is pinned; commit refused.',
  '目标技能「{target}」是受保护的内置技能。': 'Target skill "{target}" is a protected built-in skill.',
  '目标技能「{target}」的内容在决策之后被改过；拒绝提交（未写入任何内容）。': 'Content of target skill "{target}" was modified after the decision; commit refused (nothing was written).',
  '目标目录「{target}」已存在但不是技能；拒绝把 SKILL.md 写进同名目录。': 'Target directory "{target}" already exists but is not a skill; refusing to write SKILL.md into a same-named directory.',
  '确认': 'Confirm',
  '第 {position} 个操作（add）：必须提供 facts。未应用任何操作。{preview}': 'Operation #{position} (add): facts is required. No operations were applied.{preview}',
  '第 {position} 个操作（add）：该条目含有分隔符（§），会被拆成多条；请改写为多条独立的事实。{preview}': 'Operation #{position} (add): this entry contains the delimiter (§) and would be split into multiple entries; rewrite it as separate independent facts.{preview}',
  '第 {position} 个操作（replace）：必须提供 facts。{preview}': 'Operation #{position} (replace): facts is required.{preview}',
  '第 {position} 个操作（replace）：该条目含有分隔符（§），会被拆成多条；请改写为多条独立的事实。{preview}': 'Operation #{position} (replace): this entry contains the delimiter (§) and would be split into multiple entries; rewrite it as separate independent facts.{preview}',
  '第 {position} 个操作（{action}）：必须提供 old_text。未应用任何操作。{preview}': 'Operation #{position} ({action}): old_text is required. No operations were applied.{preview}',
  '第 {position} 个操作：{threat}{preview}': 'Operation #{position}: {threat}{preview}',
  '第 {position} 个操作：「{needle}」匹配到多条不同条目。未应用任何操作。{preview}': 'Operation #{position}: "{needle}" matched multiple distinct entries. No operations were applied.{preview}',
  '第 {position} 个操作：找不到匹配 "{needle}" 的条目。未应用任何操作。': 'Operation #{position}: no entry matched "{needle}". No operations were applied.',
  '第 {position} 个操作：未知动作「{action}」（应为 add/remove/replace）。未应用任何操作。{preview}': 'Operation #{position}: unknown action "{action}" (expected add/remove/replace). No operations were applied.{preview}',
  '补丁被拒绝：frontmatter 无法自动修复（{issue}）。': 'Patch refused: frontmatter cannot be auto-repaired ({issue}).',
  '补丁被拒绝：{validation}': 'Patch refused: {validation}',
  '记忆文件为 {size} 字节 —— 即使只做删除批处理也过大、无法加载。请手动修复该文件后重试。': 'Memory file is {size} bytes — too large to load even for a delete-only batch. Repair the file manually and retry.',
  '记忆文件为 {size} 字节（上限 {limit}）—— 跳过读取。{suffix} 请手动修复该文件后重试。': 'Memory file is {size} bytes (limit {limit}) — skipping read.{suffix} Repair the file manually and retry.',
  '该条目含有分隔符（§），会被拆成多条；请改写为多条独立的事实。': 'This entry contains the delimiter (§) and would be split into multiple entries; rewrite it as separate independent facts.',
  '该条目已存在（未重复添加）。{hint}': 'This entry already exists (not added again).{hint}',
  '请给出文件名，不能只给目录。': 'Provide a filename, not just a directory.',
  '读不出「{label}」：{detail}。没有写入任何内容。': 'Could not read "{label}": {detail}. Nothing was written.',
  '运行索引读不出来（不是 JSON，或没有 runs 数组）—— 上一次的运行历史未知（报告不受影响）': 'Run index is unreadable (not valid JSON or missing the runs array) — previous run history is unknown (reports are unaffected)',
  '这些归档项没有可读的 SKILL.md（或名字对不上），按名字恢复无法区分它们：请把目录改成技能名后再次恢复；快照这条路的当前状态是：{availability}。': 'These archived items have no readable SKILL.md (or their names do not match), so restoring by name cannot distinguish them: rename the directory to the skill name and restore again; current status of the snapshot path: {availability}.',
  '重构至少需要一次章节搬移。': 'Restructure requires at least one section move.',
  '重构被拒绝：{reason}': 'Restructure refused: {reason}',
  '重构被拒绝：章节「## {heading}」引用了会留在原地的支撑文件（{refs}）：请拆开该章节，或连同它的文件一起搬。': 'Restructure refused: section "## {heading}" cites supporting files that would remain in place ({refs}): split the section or move its files along with it.',
  '重构被拒绝：章节「## {heading}」引用的支撑文件不存在（{missing}）：请修正引用，或先创建该文件。': 'Restructure refused: section "## {heading}" cites non-existent supporting files ({missing}): fix the references or create those files first.',
  '重构超过 {limit} 次搬移。': 'Restructure exceeds {limit} moves.',
  },
  ja: {
  ' 已把备份保存到 {name}。': ' バックアップを {name} に保存しました。',
  ' 等': ' など',
  ' （警告：{warnings}）': ' （警告：{warnings}）',
  ' （警告：写入已落盘，但目录 fsync 失败 —— 持久性未确认：{warnings})': ' （警告：ディスクへの書き込みは完了しましたが、ディレクトリの fsync に失敗したため永続性は未確認です：{warnings}）',
  '.archive 里没有「{name}」对应的 frontmatter 名，但有 {count} 个名字相似的归档项：{items}。': '.archive 内にフロントマター名「{name}」に一致する項目はありませんが、名前の似たアーカイブ項目が {count} 件あります：{items}。',
  'Frontmatter 字段 {fields} 必须是字符串：平台技能目录会把这种字段当作缺失，并忽略整个文件。请写成纯文本，或用双引号包住取值以保持字面内容。': 'フロントマターのフィールド {fields} は文字列である必要があります。プラットフォームのスキルカタログは文字列以外のフィールドを欠落として扱い、ファイル全体を無視します。プレーンテキストで記述するか、値を二重引用符で囲んでリテラル内容を保持してください。',
  'Frontmatter 必须包含 description 字段。': 'フロントマターには description フィールドが必要です。',
  'Frontmatter 必须包含 name 字段。': 'フロントマターには name フィールドが必要です。',
  'Frontmatter 里的 name「{name}」与目标技能「{target}」不一致。': 'フロントマター内の name「{name}」がターゲットスキル「{target}」と一致しません。',
  'SKILL.md 内容超过 {limit} 个字符。{hint}': 'SKILL.md の内容が {limit} 文字を超えています。{hint}',
  'SKILL.md 必须以 `---` 行开头，用另一个完全相同的 `---` 行结束 frontmatter（只容忍结尾的 `\\r`），并在其下包含正文。': 'SKILL.md は `---` の行で始まり、全く同じ `---` の行でフロントマターを閉じ（末尾の `\\r` のみ許容されます）、その下に本文を含む必要があります。',
  'SKILL.md 没有有效的 frontmatter；拒绝重构。': 'SKILL.md に有効なフロントマターがないため、再構成を拒否しました。',
  'absorbed_into 不能是正在归档的技能本身（不能吸收到自己）。': 'absorbed_into にアーカイブ対象のスキル自身を指定することはできません（自分自身には統合できません）。',
  'description 超过 {limit} 个字符。': 'description が {limit} 文字を超えています。',
  'external support 不是普通文件：{path}': 'external support が通常ファイルではありません：{path}',
  'external support 文件不存在：{path}': 'external support ファイルが存在しません：{path}',
  'external support 根目录不可读：{path}': 'external support のルートディレクトリを読み取れません：{path}',
  'external support 目标冲突：{path}': 'external support のターゲットが競合しています：{path}',
  'external support 超过单文件上限：{path}': 'external support が単一ファイルの上限を超えています：{path}',
  'external support 超过总上限：{path}': 'external support が合計サイズの上限を超えています：{path}',
  'external support 越界：{path}': 'external support のパスが範囲外です：{path}',
  'extract 的每一项都必须是对象。': 'extract の各項目はオブジェクトである必要があります。',
  'extract 的每一项都需要 heading 与 to_skill。': 'extract の各項目には heading と to_skill が必要です。',
  'extract 需要 name 与至少一个 extract 项。': 'extract には name と少なくとも 1 つの extract 項目が必要です。',
  'hermes-managed 标记已落盘，但其目录 fsync 失败 —— 持久性未确认：{cause}': 'hermes-managed マーカーはディスクに書き込まれましたが、ディレクトリの fsync に失敗したため永続性は未確認です：{cause}',
  'operations 列表为空。': 'operations リストが空です。',
  'outcome 只能是 extract 或 mixed；owner-gap 由缺失 target 的路径自动决定。': 'outcome は extract または mixed のみ指定できます。owner-gap は target が欠落している経路で自動的に決定されます。',
  'row `{row}` 在本组合中不提供服务': '行 `{row}` はこの構成でサービスを提供していません',
  'row `{row}` 没有这个参数': '行 `{row}` にはこのパラメータがありません',
  'source 与 target 不能相同。': 'source と target に同じものを指定することはできません。',
  'source 没有有效 frontmatter': 'source に有効なフロントマターがありません',
  'target 已有同名 heading「{heading}」。': 'target には同名の見出し「{heading}」がすでに存在します。',
  'target 没有有效 frontmatter': 'target に有効なフロントマターがありません',
  'to_heading 暂不支持改名；G3 要求 heading 与 to_heading 相同。': 'to_heading による見出し名の変更には現在対応していません。G3 では heading と to_heading が同一である必要があります。',
  '{count} 条记忆超过了配置的 {target}CharLimit（{limit}）；它们是在更高上限下写入的。请提高上限或删除条目 —— 删除类操作仍然可用。': '{count} 件のメモリが設定された {target}CharLimit（{limit}）を超えています（より高い上限のもとで書き込まれた項目です）。上限を引き上げるか項目を削除してください。削除系の操作は引き続き利用できます。',
  '{path}（单元前字节读不到：blob {hash}）': '{path}（ユニット適用前のバイト列を読み取れません：blob {hash}）',
  '{path}（单元里没有该路径的 after 条目）': '{path}（ユニット内にこのパスの after 項目がありません）',
  '{path}（盘上字节已变，回退会覆盖别人的改动）': '{path}（ディスク上のバイト列が変更されており、巻き戻すと他の変更を上書きしてしまいます）',
  '{path}（盘上文件不存在）': '{path}（ディスク上にファイルが存在しません）',
  '{path}：{message} —— 撤销未完成（已回退：{done}）。': '{path}：{message}（取り消し未完了、巻き戻し済み：{done}）。',
  '{skill}（归档成员不在 .archive）': '{skill}（アーカイブメンバーが .archive にありません）',
  '{skill}（归档成员缺少归档路径）': '{skill}（アーカイブメンバーにアーカイブパスがありません）',
  '{skill}（成员技能不在活动树或归档里）': '{skill}（メンバースキルがアクティブツリーにもアーカイブにもありません）',
  '{skill}：SKILL.md 缺少单元前字节': '{skill}：SKILL.md にユニット適用前のバイト列がありません',
  '一次 extract 只能有一个 to_skill；多目标请分多次调用。': '1 回の extract で指定できる to_skill は 1 つのみです。複数のターゲットに抽出する場合は複数回に分けて呼び出してください。',
  '不允许路径穿越。': 'パストラバーサルは許可されていません。',
  '不支持的文件名「{part}」：.corrupt/.tmp 后缀由状态与 IO 协议保留。': 'サポートされていないファイル名「{part}」：.corrupt および .tmp 接尾辞は状態管理と IO プロトコル用に予約されています。',
  '不支持的文件名「{part}」：请只用小写字母、数字、点、连字符和下划线（首字符须为字母或数字）。': 'サポートされていないファイル名「{part}」：英小文字、数字、ドット、ハイフン、アンダースコアのみを使用してください（先頭は英数字である必要があります）。',
  '不支持的文件名「{part}」：这是 Windows 保留设备名。': 'サポートされていないファイル名「{part}」：Windows の予約デバイス名です。',
  '从 .archive 恢复「{name}」失败：{reason}': '.archive から「{name}」を復元できませんでした：{reason}',
  '修补后的内容超过 {limit} 个字符。{hint}': 'パッチ適用後の内容が {limit} 文字を超えています。{hint}',
  '修补后的文件内容超过 {limit} 个字符。{hint}': 'パッチ適用後のファイル内容が {limit} 文字を超えています。{hint}',
  '修补后的文件超过 {limit} 字节。': 'パッチ適用後のファイルが {limit} バイトを超えています。',
  '候选 owner：{names}。': '候補 owner：{names}。',
  '内容不能为空。': '内容を空にすることはできません。',
  '内部错误：写事务没有调用任务；未执行任何写入': '内部エラー：書き込みトランザクションに呼び出し元のタスクがないため、書き込みは実行されませんでした',
  '内部错误：删除事务没有调用任务；没有删除任何东西': '内部エラー：削除トランザクションに呼び出し元のタスクがないため、削除は実行されませんでした',
  '内部错误：记忆写事务没有调用任务；未执行任何写入': '内部エラー：メモリ書き込みトランザクションに呼び出し元のタスクがないため、書き込みは実行されませんでした',
  '写入已落盘，但目录 fsync 失败 —— 持久性未确认：{cause}': 'ディスクへの書き込みは完了しましたが、ディレクトリの fsync に失敗したため永続性は未確認です：{cause}',
  '写入超过 {limit} 字节：{path}': '書き込みサイズが {limit} バイトを超えています：{path}',
  '创建': '作成',
  '创建技能 "{name}"？会在家族目录树里新建一个技能目录。': 'スキル "{name}" を作成しますか？ファミリのディレクトリツリー内に新しいスキルディレクトリが作成されます。',
  '创建过程中技能「{name}」被并发归档；残留标记已移除：等搬运完成后重试一次。': '作成中にスキル「{name}」が並行してアーカイブされました。残存マーカーは削除されたため、移動処理の完了後に再試行してください。',
  '删除': '削除',
  '删除技能 "{name}"？它会被归档到 .archive 并离开目录。': 'スキル "{name}" を削除しますか？.archive にアーカイブされ、カタログから外れます。',
  '功能：{description}': '機能：{description}',
  '参与合并的技能支撑文件在决策之后被改过；拒绝提交（未写入任何内容）。': '決定後にマージ対象スキルのサポートファイルが変更されたため、コミットを拒否しました（何も書き込まれていません）。',
  '取消': 'キャンセル',
  '只有前台（用户或主智能体）可以固定或取消固定技能。': 'スキルのピン留めおよび解除は、フォアグラウンド（ユーザーまたはメインエージェント）からのみ行えます。',
  '合并失败（{reason}）；已回滚，但以下未回滚：{stuck}：它们仍在 .archive 里，请用 /evolution skill restore 恢复。': 'マージに失敗しました（{reason}）。ロールバックを行いましたが、次はロールバックされませんでした：{stuck}。.archive 内に残っているため、/evolution skill restore で復元してください。',
  '合并失败，已回滚：{reason}': 'マージに失敗したため、ロールバックしました：{reason}',
  '合并至少需要一个互不相同的来源技能。': 'マージには少なくとも 1 つの異なるソーススキルが必要です。',
  '合并被拒绝：{reason} 会被落下。请改用 mode:\'reference\'，或直接归档整个包。{note}': 'マージが拒否されました：{reason} が取り残されます。mode:\'reference\' を使用するか、パッケージ全体をそのままアーカイブしてください。{note}',
  '合并被拒绝：来源技能「{source}」的正文引用了会被落下的支撑文件（{refs}）：请改为归档整个包。{note}': 'マージが拒否されました：ソーススキル「{source}」の本文が、取り残されるサポートファイル（{refs}）を参照しています。パッケージ全体をそのままアーカイブしてください。{note}',
  '固定过程中技能「{name}」被并发归档；残留标记已移除：等搬运完成后重试。': 'ピン留め中にスキル「{name}」が並行してアーカイブされました。残存マーカーは削除されたため、移動処理の完了後に再試行してください。',
  '在「{name}/{path}」里找不到 old_string（或 replaceAll 的模糊匹配预算已用尽）。整篇重写请改用 update。': '「{name}/{path}」内に old_string が見つかりません（または replaceAll のあいまい一致の上限に達しました）。全体を書き換える場合は update を使用してください。',
  '在任何清理之前就拒绝了快照恢复：生成回滚前快照失败（{reason}）—— 活动目录树未改变。请解决快照写入失败后重试。': 'クリーンアップ前の段階でスナップショットの復元を拒否しました：ロールバック前スナップショットの生成に失敗しました（{reason}）。アクティブなディレクトリツリーは変更されていません。スナップショット書き込み失敗の原因を解消してから再試行してください。',
  '在任何清理之前就拒绝了快照恢复：读取快照清单或附属文件失败（{reason}）—— 活动目录树未改变。请解决读取失败后重试。': 'クリーンアップ前の段階でスナップショットの復元を拒否しました：スナップショットのマニフェストまたは付属ファイルの読み取りに失敗しました（{reason}）。アクティブなディレクトリツリーは変更されていません。読み取り失敗の原因を解消してから再試行してください。',
  '在任何清理之前就拒绝了快照恢复； 活动目录树未改变。\n- 目标：{reason}\n- 回滚前快照：{rollback}\n请解决原因（有存活的技能写入，或快照不完整）后重试 —— 无需手动抢救。': 'クリーンアップ前の段階でスナップショットの復元を拒否しました。アクティブなディレクトリツリーは変更されていません。\n- ターゲット：{reason}\n- ロールバック前スナップショット：{rollback}\n原因（進行中のスキル書き込み、または不完全なスナップショット）を解消してから再試行してください（手動での復旧作業は不要です）。',
  '复制成功，但源目录删不掉（{reason}），且复制出的目录树也无法回滚 —— 该目录树现在同时存在于两处；请手动清理': 'コピーには成功しましたが、ソースディレクトリを削除できず（{reason}）、コピー先のディレクトリツリーもロールバックできませんでした。ディレクトリツリーが現在 2 か所に存在するため、手動で整理してください',
  '复制成功，但源目录删不掉（{reason}）；已回滚复制出的目录树': 'コピーには成功しましたが、ソースディレクトリを削除できなかったため（{reason}）、コピー先のディレクトリツリーをロールバックしました',
  '已从 {path} 恢复技能目录树': '{path} からスキルディレクトリツリーを復元しました',
  '已创建技能「{name}」。{warnings}': 'スキル「{name}」を作成しました。{warnings}',
  '已应用 {count} 个操作。{hint}': '{count} 件の操作を適用しました。{hint}',
  '已把 {sources} 合并进「{target}」。': '{sources} を「{target}」にマージしました。',
  '已按单元撤销：{list}。': 'ユニット単位で元に戻しました：{list}。',
  '已添加条目。{hint}': '項目を追加しました。{hint}',
  '已记录的内容版本数：{versions}': '記録済みのコンテンツバージョン数：{versions}',
  '已重构「{name}」：把 {count} 个章节搬到 references/。': '「{name}」を再構成しました：{count} 個のセクションを references/ に移動しました。',
  '建议拆成更小的 SKILL.md，把支撑文件放进 references/ 或 templates/。': 'SKILL.md を小さく分割し、サポートファイルを references/ または templates/ に配置することを検討してください。',
  '归档新目标「{skill}」失败：{message} —— 撤销未完成（已回退：{done}）。': '新しいターゲット「{skill}」のアーカイブに失敗しました：{message}（取り消し未完了、巻き戻し済み：{done}）。',
  '归档项「{name}」是符号链接；拒绝恢复。': 'アーカイブ項目「{name}」はシンボリックリンクのため、復元を拒否しました。',
  '当前没有可用 owner candidate（描述为空或被排除）。': '現在利用可能な候補 owner がありません（説明が空であるか除外されています）。',
  '当前没有可用快照': '現在利用可能なスナップショットがありません',
  '快照恢复失败（{reason}），且回滚前快照的恢复也失败（{rollback}）。请手动抢救：{preRollback}（回滚前）、{target}（目标）。': 'スナップショットの復元に失敗し（{reason}）、ロールバック前スナップショットからの復元にも失敗しました（{rollback}）。手動で復旧してください：{preRollback}（ロールバック前）、{target}（ターゲット）。',
  '快照恢复失败（{reason}）；活动目录树已回滚到回滚前的快照。': 'スナップショットの復元に失敗しました（{reason}）。アクティブなディレクトリツリーはロールバック前のスナップショットに巻き戻されました。',
  '快照目录读不出来（{reason}）': 'スナップショットディレクトリを読み取れません（{reason}）',
  '恢复「{skill}」失败：{message} —— 撤销未完成（已回退：{done}）。': '「{skill}」の復元に失敗しました：{message}（取り消し未完了、巻き戻し済み：{done}）。',
  '批处理结果（{total} 字符）超过 {limit} 上限。请在同一个批里再删除或缩短一些条目。': 'バッチ処理後の結果（{total} 文字）が上限（{limit} 文字）を超えています。同じバッチ内でさらにいくつかの項目を削除または短縮してください。',
  '技能 "{name}" 在读取之后被改动过；为避免覆盖更新的内容，本次写入被拒绝。': 'スキル "{name}" は読み取り後に変更されています。新しい内容の上書きを防ぐため、今回の書き込みを拒否しました。',
  '技能 "{name}" 已取消固定。': 'スキル "{name}" のピン留めを解除しました。',
  '技能 "{name}" 已固定：免受删除、后台复核与生命周期影响。': 'スキル "{name}" をピン留めしました：削除、バックグラウンドレビュー、ライフサイクル遷移の対象外になります。',
  '技能 "{name}" 的支撑文件 "{path}" 在读取之后被改动过；为避免覆盖更新的内容，本次写入被拒绝。': 'スキル "{name}" のサポートファイル "{path}" は読み取り後に変更されています。新しい内容の上書きを防ぐため、今回の書き込みを拒否しました。',
  '技能「{name}」不在 .archive 里。': 'スキル「{name}」は .archive 内にありません。',
  '技能「{name}」不存在。': 'スキル「{name}」は存在しません。',
  '技能「{name}」与已存在的大小写变体目录「{entry}」冲突（技能名只允许小写）：请重命名其中一个。': 'スキル「{name}」は大文字・小文字のみが異なる既存のディレクトリ「{entry}」と競合しています（スキル名は小文字のみ使用可能です）。いずれかの名前を変更してください。',
  '技能「{name}」受保护（{protection}）。': 'スキル「{name}」は保護されています（{protection}）。',
  '技能「{name}」已从 .archive 恢复。': 'スキル「{name}」を .archive から復元しました。',
  '技能「{name}」已修补（{path}）。{note}{advisory}': 'スキル「{name}」にパッチを適用しました（{path}）。{note}{advisory}',
  '技能「{name}」已存在。': 'スキル「{name}」はすでに存在します。',
  '技能「{name}」已存在于当前根目录；拒绝覆盖。': 'スキル「{name}」は現在のルートディレクトリにすでに存在するため、上書きを拒否しました。',
  '技能「{name}」已归档到 .archive。': 'スキル「{name}」を .archive にアーカイブしました。',
  '技能「{name}」已更新。{warning}{retention}': 'スキル「{name}」を更新しました。{warning}{retention}',
  '技能「{name}」已被固定。': 'スキル「{name}」はすでにピン留めされています。',
  '技能「{name}」归档失败：{reason}。': 'スキル「{name}」のアーカイブに失敗しました：{reason}。',
  '技能「{name}」是符号链接；拒绝归档。': 'スキル「{name}」はシンボリックリンクのため、アーカイブを拒否しました。',
  '技能「{name}」未变更：old_string 与替换内容相同（{path}），未写入。': 'スキル「{name}」は変更されませんでした：old_string と置換後の内容が同一（{path}）のため、書き込みは行われませんでした。',
  '技能「{name}」未变更：提供的内容与当前文件一致，未写入。': 'スキル「{name}」は変更されませんでした：指定された内容が現在のファイルと一致するため、書き込みは行われませんでした。',
  '技能「{name}」未被固定，无需处理。': 'スキル「{name}」はピン留めされていないため、対応は不要です。',
  '技能「{name}」没有可读取的正文。': 'スキル「{name}」には読み取り可能な本文がありません。',
  '技能「{name}」没有有效的 frontmatter；拒绝合并。': 'スキル「{name}」に有効なフロントマターがないため、マージを拒否しました。',
  '技能「{name}」没有有效的 frontmatter；拒绝降级。': 'スキル「{name}」に有効なフロントマターがないため、降格を拒否しました。',
  '技能「{name}」的 frontmatter 无法自动修复：{issue}：请用双引号包住取值后重试。': 'スキル「{name}」のフロントマターを自動修復できません：{issue}。値を二重引用符で囲んでから再試行してください。',
  '技能「{variant}」（同名、仅大小写不同）已存在于当前根目录；把「{name}」恢复到它旁边会造成含义不清的重复：请恢复为「{variant}」，或先移除该变体。': '現在のルートディレクトリに同名で大文字・小文字のみが異なるスキル「{variant}」がすでに存在します。「{name}」を並べて復元すると紛らわしい重複が生じるため、「{variant}」として復元するか、先に既存のディレクトリを削除してください。',
  '技能名「{name}」不合法：请只用小写字母、数字和连字符。': 'スキル名「{name}」が不正です：英小文字、数字、ハイフンのみを使用してください。',
  '技能名「{name}」不合法：请只用小写字母、数字和连字符（不超过 {limit} 个）。': 'スキル名「{name}」が不正です：英小文字、数字、ハイフンのみを使用してください（最大 {limit} 文字）。',
  '技能名超过 {limit} 个字符。': 'スキル名が {limit} 文字を超えています。',
  '技能目录「{name}」已存在于当前根目录，但没有 SKILL.md；恢复前请先移除或修复它。': 'スキルディレクトリ「{name}」が現在のルートディレクトリにすでに存在しますが、SKILL.md がありません。復元する前に削除または修復してください。',
  '拒绝快照恢复：快照目录读不出来（{reason}）—— 未做任何改动。': 'スナップショットの復元を拒否しました：スナップショットディレクトリを読み取れません（{reason}）。変更は行われていません。',
  '拒绝目录树变更：删除目标不存在 {path}': 'ディレクトリツリーの変更を拒否しました：削除対象が存在しません {path}',
  '拒绝目录树变更：无法安全预读 {path}（{cause}）；未执行任何写入': 'ディレクトリツリーの変更を拒否しました：{path} を安全に事前読み取りできません（{cause}）。書き込みは実行されませんでした',
  '描述为 {chars}/60 个字符 —— 在作者规范上限之内。': '説明は {chars}/60 文字で、作成規約の上限内に収まっています。',
  '描述为 {chars}/60 个字符 —— 超过 60 字符的作者规范上限（Hermes 标准；技能目录会按平台配置的上限截断）。': '説明は {chars}/60 文字で、作成規約の上限である 60 文字を超えています（Hermes 基準。スキルカタログではプラットフォーム設定の上限で切り詰められます）。',
  '描述里含冒号 —— 请用双引号把整个取值包起来。': '説明にコロンが含まれているため、値全体を二重引用符で囲んでください。',
  '提取失败：{errors}': '抽出に失敗しました：{errors}',
  '提取被拒绝：external support 缺少已验证的内容 {path}': '抽出を拒否しました：external support に検証済みの内容がありません {path}',
  '提取被拒绝：external target 不安全 {path}': '抽出を拒否しました：external target が安全ではありません {path}',
  '提取被拒绝：owner-gap 不是写操作。': '抽出を拒否しました：owner-gap は書き込み操作ではありません。',
  '提取被拒绝：source 与 target 相同。': '抽出を拒否しました：source と target が同一です。',
  '提取被拒绝：source/target 在计划之后发生了变化；请重新计划。': '抽出を拒否しました：計画後に source または target が変更されました。再度計画を作成してください。',
  '提取被拒绝：support closure 存在 unresolved/dangling。': '抽出を拒否しました：support closure に未解決またはリンク切れの参照が含まれています。',
  '提取被拒绝：support 文件不存在 {path}': '抽出を拒否しました：サポートファイルが存在しません {path}',
  '提取被拒绝：target 不在技能库中。': '抽出を拒否しました：target がスキルライブラリ内にありません。',
  '提取被拒绝：target 不存在；owner-gap 不自动 create。': '抽出を拒否しました：target が存在せず、owner-gap では自動作成を行いません。',
  '提取被拒绝：target 不是家族管理的技能。': '抽出を拒否しました：target はファミリ管理対象のスキルではありません。',
  '提取被拒绝：{message}': '抽出を拒否しました：{message}',
  '提取被拒绝：待删除 support 不存在 {path}': '抽出を拒否しました：削除対象のサポートファイルが存在しません {path}',
  '提取被拒绝：没有 part。': '抽出を拒否しました：part がありません。',
  '支撑文件「{path}」已从「{name}」移除。': 'サポートファイル「{path}」を「{name}」から削除しました。',
  '支撑文件「{path}」已写入「{name}」。{advisory}{warning}': 'サポートファイル「{path}」を「{name}」に書き込みました。{advisory}{warning}',
  '支撑文件「{path}」未变更：提供的内容与当前文件一致，未写入。': 'サポートファイル「{path}」は変更されませんでした：指定された内容が現在のファイルと一致するため、書き込みは行われませんでした。',
  '支撑文件「{path}」的内容超过 {limit} 个字符。{hint}': 'サポートファイル「{path}」の内容が {limit} 文字を超えています。{hint}',
  '支撑文件列表不可读；拒绝在不确定的闭包上提取。': 'サポートファイル一覧を読み取れないため、不確定なクロージャに対する抽出を拒否しました。',
  '支撑文件超过 {limit} 字节。': 'サポートファイルが {limit} バイトを超えています。',
  '支撑文件超过 {limit} 字节：{path}': 'サポートファイルが {limit} バイトを超えています：{path}',
  '支撑文件重复：{path}': 'サポートファイルが重複しています：{path}',
  '整单元撤销未开始（零写）—— 预检未通过：{refusals}。修好后可重试。': '事前チェックを通過できなかったため、ユニット全体の取り消しは開始されませんでした（書き込み 0 件）：{refusals}。修正後に再試行できます。',
  '文件「{path}」不在技能「{name}」里。': 'ファイル「{path}」はスキル「{name}」内にありません。',
  '文件不存在：{path}': 'ファイルが存在しません：{path}',
  '新内容保留了上一版正文的 {kept}%（{after}／{before} 字符）；被替换的版本已保留在该技能的历史里。': '新しい内容は前バージョンの本文の {kept}%（{after}／{before} 文字）を保持しています。置き換えられたバージョンはこのスキルの履歴に保存されています。',
  '无': 'なし',
  '无法检查技能「{name}」是否与大小写变体冲突：列出 {root} 失败（{cause}）。拒绝创建 —— 仅大小写不同的第二个目录在跨平台时无法撤销。': 'スキル「{name}」に大文字・小文字の競合がないか確認できませんでした：{root} の一覧取得に失敗しました（{cause}）。大文字・小文字のみが異なる 2 つ目のディレクトリはクロスプラットフォーム環境で元に戻せないため、作成を拒否しました。',
  '无法检查技能「{name}」是否有写入方（有一个支撑目录列不出来）：请重试归档。': 'スキル「{name}」に書き込み中の主体があるか確認できませんでした（一覧取得できないサポートディレクトリがあります）。アーカイブを再試行してください。',
  '无法检查技能「{name}」是否有写入方（有一个支撑目录列不出来）：请重试恢复。': 'スキル「{name}」に書き込み中の主体があるか確認できませんでした（一覧取得できないサポートディレクトリがあります）。復元を再試行してください。',
  '无法读取技能 "{name}" 以校验暂存内容。': 'スキル "{name}" を読み取れないため、一時保存された内容を検証できません。',
  '无法读取技能 "{name}" 的支撑文件 "{path}" 以校验暂存内容。': 'スキル "{name}" のサポートファイル "{path}" を読み取れないため、一時保存された内容を検証できません。',
  '最新快照 {path}': '最新のスナップショット {path}',
  '未知': '不明',
  '本轮记忆整理已失败 {count} 次。请停止重试记忆调用，继续处理用户的任务。{preview}': 'このターンのメモリ整理は {count} 回失敗しました。メモリ呼び出しの再試行を中止し、ユーザーのタスクを続行してください。{preview}',
  '来源技能「{source}」不存在。': 'ソーススキル「{source}」は存在しません。',
  '来源技能「{source}」在归档前被改过': 'ソーススキル「{source}」がアーカイブ前に変更されました',
  '来源技能「{source}」在计划之后被改过；拒绝提交（未写入任何内容）。': '計画後にソーススキル「{source}」が変更されたため、コミットを拒否しました（何も書き込まれていません）。',
  '来源技能「{source}」是受保护的内置技能。': 'ソーススキル「{source}」は保護された組み込みスキルです。',
  '来源技能「{source}」的内容在决策之后被改过；拒绝提交（未写入任何内容）。': '決定後にソーススキル「{source}」の内容が変更されたため、コミットを拒否しました（何も書き込まれていません）。',
  '来源技能「{source}」缺少计划字节；拒绝提交。': 'ソーススキル「{source}」に計画時のバイト列がないため、コミットを拒否しました。',
  '检测到记忆文件被外部改动。{suffix} 请先处理该漂移再重试。': 'メモリファイルが外部で変更されたことを検出しました。{suffix} 先にこの差分を解消してから再試行してください。',
  '正文引用了未提供的支撑文件「{ref}」；拒绝提交。': '本文が未提供のサポートファイル「{ref}」を参照しているため、コミットを拒否しました。',
  '每次重构搬移都必须是带 heading 的对象。': '再構成の各移動項目は heading を持つオブジェクトである必要があります。',
  '每次重构搬移都需要非空的 heading。': '再構成の各移動項目には空でない heading が必要です。',
  '没有可用的技能归档。': '利用可能なスキルアーカイブがありません。',
  '没有可用的技能快照。': '利用可能なスキルスナップショットがありません。',
  '添加该条目会超过 {limit} 字符上限。请先合并或删除过期条目，再重试。': 'この項目を追加すると {limit} 文字の上限を超えます。先に古い項目を統合または削除してから、再試行してください。',
  '清单读不出来或缺失（孤儿快照）': 'マニフェストを読み取れないか欠落しています（孤立したスナップショット）',
  '目录树变更为空。': 'ディレクトリツリーの変更内容が空です。',
  '目录树变更声明了重复的根「{name}」。': 'ディレクトリツリーの変更でルート「{name}」が重複して宣言されています。',
  '目录树变更失败，已回滚：{reason}': 'ディレクトリツリーの変更に失敗したため、ロールバックしました：{reason}',
  '目录树变更失败：{reason}。回滚无法恢复 {stuck}：可恢复性由当前快照决定：{availability} —— 若上面不是「最新快照」，请重新应用这次变更。': 'ディレクトリツリーの変更に失敗しました：{reason}。ロールバックで {stuck} を復元できませんでした。復元可能かどうかは現在のスナップショットに依存します：{availability}（上記が「最新のスナップショット」でない場合は、この変更を再適用してください）。',
  '目录树变更的 primary skill「{name}」不在 roots 中。': 'ディレクトリツリー変更の primary skill「{name}」が roots に含まれていません。',
  '目标「{name}」不是可用的 owner candidate（描述为空或已排除）；owner-gap，不自动 create。': 'ターゲット「{name}」は利用可能な候補 owner ではありません（説明が空であるか除外されています）。owner-gap のため自動作成は行いません。',
  '目标「{name}」不是家族 managed 技能；拒绝把可复用部分写进不受管目录。': 'ターゲット「{name}」はファミリ管理対象のスキルではないため、管理外のディレクトリへの再利用部分の書き込みを拒否しました。',
  '目标「{name}」受保护（{protection}），拒绝提取。': 'ターゲット「{name}」は保護されているため（{protection}）、抽出を拒否しました。',
  '目标「{name}」投影后约 {chars} 字符，超过 {limit} 上限；拒绝提取。': 'ターゲット「{name}」は投影後に約 {chars} 文字となり上限（{limit} 文字）を超えるため、抽出を拒否しました。',
  '目标「{target}」描述与邻技能重叠：{overlaps}；请确认 owner 覆盖，提取仍可继续。': 'ターゲット「{target}」の説明が近隣スキルと重複しています：{overlaps}。owner の対象範囲を確認してください（抽出自体は続行可能です）。',
  '目标不属于任何声明的技能根：{path}': 'ターゲットがいずれの宣言済みスキルルートにも属していません：{path}',
  '目标声明的技能「{skill}」不在 roots 中：{path}': 'ターゲットが宣言したスキル「{skill}」が roots に含まれていません：{path}',
  '目标技能「{name}」已超过 {limit} 字符，拒绝继续提取。': 'ターゲットスキル「{name}」がすでに {limit} 文字を超えているため、これ以上の抽出を拒否しました。',
  '目标技能「{target}」不存在。': 'ターゲットスキル「{target}」は存在しません。',
  '目标技能「{target}」不是 family-managed；拒绝提交。': 'ターゲットスキル「{target}」が family-managed ではないため、コミットを拒否しました。',
  '目标技能「{target}」在计划之后被改过；拒绝提交（未写入任何内容）。': '計画後にターゲットスキル「{target}」が変更されたため、コミットを拒否しました（何も書き込まれていません）。',
  '目标技能「{target}」已存在。': 'ターゲットスキル「{target}」はすでに存在します。',
  '目标技能「{target}」已被固定；拒绝提交。': 'ターゲットスキル「{target}」はピン留めされているため、コミットを拒否しました。',
  '目标技能「{target}」是受保护的内置技能。': 'ターゲットスキル「{target}」は保護された組み込みスキルです。',
  '目标技能「{target}」的内容在决策之后被改过；拒绝提交（未写入任何内容）。': '決定後にターゲットスキル「{target}」の内容が変更されたため、コミットを拒否しました（何も書き込まれていません）。',
  '目标目录「{target}」已存在但不是技能；拒绝把 SKILL.md 写进同名目录。': 'ターゲットディレクトリ「{target}」はすでに存在しますがスキルではないため、同名ディレクトリへの SKILL.md の書き込みを拒否しました。',
  '确认': '確認',
  '第 {position} 个操作（add）：必须提供 facts。未应用任何操作。{preview}': '{position} 番目の操作（add）：facts の指定が必要です。操作は適用されませんでした。{preview}',
  '第 {position} 个操作（add）：该条目含有分隔符（§），会被拆成多条；请改写为多条独立的事实。{preview}': '{position} 番目の操作（add）：この項目には区切り文字（§）が含まれており複数項目に分割されてしまうため、独立した複数の事実として書き直してください。{preview}',
  '第 {position} 个操作（replace）：必须提供 facts。{preview}': '{position} 番目の操作（replace）：facts の指定が必要です。{preview}',
  '第 {position} 个操作（replace）：该条目含有分隔符（§），会被拆成多条；请改写为多条独立的事实。{preview}': '{position} 番目の操作（replace）：この項目には区切り文字（§）が含まれており複数項目に分割されてしまうため、独立した複数の事実として書き直してください。{preview}',
  '第 {position} 个操作（{action}）：必须提供 old_text。未应用任何操作。{preview}': '{position} 番目の操作（{action}）：old_text の指定が必要です。操作は適用されませんでした。{preview}',
  '第 {position} 个操作：{threat}{preview}': '{position} 番目の操作：{threat}{preview}',
  '第 {position} 个操作：「{needle}」匹配到多条不同条目。未应用任何操作。{preview}': '{position} 番目の操作：「{needle}」が複数の異なる項目に一致しました。操作は適用されませんでした。{preview}',
  '第 {position} 个操作：找不到匹配 "{needle}" 的条目。未应用任何操作。': '{position} 番目の操作："{needle}" に一致する項目が見つかりません。操作は適用されませんでした。',
  '第 {position} 个操作：未知动作「{action}」（应为 add/remove/replace）。未应用任何操作。{preview}': '{position} 番目の操作：不明なアクション「{action}」です（add/remove/replace のいずれかを指定してください）。操作は適用されませんでした。{preview}',
  '补丁被拒绝：frontmatter 无法自动修复（{issue}）。': 'パッチを拒否しました：フロントマターを自動修復できません（{issue}）。',
  '补丁被拒绝：{validation}': 'パッチを拒否しました：{validation}',
  '记忆文件为 {size} 字节 —— 即使只做删除批处理也过大、无法加载。请手动修复该文件后重试。': 'メモリファイルが {size} バイトあり、削除のみのバッチ処理であっても大きすぎて読み込めません。手動でファイルを修復してから再試行してください。',
  '记忆文件为 {size} 字节（上限 {limit}）—— 跳过读取。{suffix} 请手动修复该文件后重试。': 'メモリファイルが {size} バイト（上限 {limit}）あるため、読み取りをスキップしました。{suffix} 手動でファイルを修復してから再試行してください。',
  '该条目含有分隔符（§），会被拆成多条；请改写为多条独立的事实。': 'この項目には区切り文字（§）が含まれており複数項目に分割されてしまうため、独立した複数の事実として書き直してください。',
  '该条目已存在（未重复添加）。{hint}': 'この項目はすでに存在します（重複追加はされませんでした）。{hint}',
  '请给出文件名，不能只给目录。': 'ディレクトリだけでなくファイル名を指定してください。',
  '读不出「{label}」：{detail}。没有写入任何内容。': '「{label}」を読み取れません：{detail}。何も書き込まれませんでした。',
  '运行索引读不出来（不是 JSON，或没有 runs 数组）—— 上一次的运行历史未知（报告不受影响）': '実行インデックスを読み取れません（JSON ではないか、runs 配列がありません）。前回の実行履歴は不明です（レポートには影響しません）',
  '这些归档项没有可读的 SKILL.md（或名字对不上），按名字恢复无法区分它们：请把目录改成技能名后再次恢复；快照这条路的当前状态是：{availability}。': 'これらのアーカイブ項目には読み取り可能な SKILL.md がないか名前が一致しないため、名前指定での復元では区別できません。ディレクトリ名をスキル名に変更してから再度復元してください。スナップショット経路の現在の状態：{availability}。',
  '重构至少需要一次章节搬移。': '再構成には少なくとも 1 回のセクション移動が必要です。',
  '重构被拒绝：{reason}': '再構成を拒否しました：{reason}',
  '重构被拒绝：章节「## {heading}」引用了会留在原地的支撑文件（{refs}）：请拆开该章节，或连同它的文件一起搬。': '再構成を拒否しました：セクション「## {heading}」が元の場所に残るサポートファイル（{refs}）を参照しています。セクションを分割するか、参照先ファイルも一緒に移動してください。',
  '重构被拒绝：章节「## {heading}」引用的支撑文件不存在（{missing}）：请修正引用，或先创建该文件。': '再構成を拒否しました：セクション「## {heading}」が参照しているサポートファイルが存在しません（{missing}）。参照を修正するか、先に該当ファイルを作成してください。',
  '重构超过 {limit} 次搬移。': '再構成の移動回数が上限（{limit} 回）を超えています。',
  },
}

registerHostMessages(CORE_MESSAGES)
