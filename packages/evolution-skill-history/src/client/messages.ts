/**
 * Panel copy, in a zh/en dictionary registered through the platform’s locale seat.
 *
 * Client copy is locale-owned: the entry label, the group headings, the actions, the version facts
 * (action words, relative time, deltas) and the status lines all resolve here, and the panel carries
 * no literal string of its own. Facts come from the host; only the WORDS live here.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */

/** The locale namespace this bundle registers. */
export const NS = 'evolution-skill-history'

/** Chinese dictionary. */
export const zh: Record<string, string> = {
  'entry.label': '技能历史',
  title: '技能历史',
  hint: '每次技能写入留下的内容版本。回退只改 SKILL.md 正文，标记、使用计数与策展状态不变。',
  'hint.current': '内容相同的版本会同时标「当前」。',
  search: '按名字或描述筛选',
  'search.none': '没有匹配的技能。',
  'group.content': '正文版本',
  'group.support': '文件版本（不可回退）',
  'group.support.note': '附带文件的字节与正文共用一份索引；回退不恢复它们。',
  'empty.skills': '还没有技能留下过内容版本。',
  'empty.versions': '这个技能还没有记录版本。',
  loading: '读取中…',
  refresh: '刷新',
  undo: '回退到此版',
  'undo.confirm': '确认回退',
  'undo.no': '取消',
  current: '当前',
  'versions.count': '个版本',
  'row.first': '初始版本',
  'row.summary.missing': '（未生成摘要）',
  'row.delta.up': '（+{n} 字符）',
  'row.delta.down': '（-{n} 字符）',
  'diff.show': '差异',
  'diff.hide': '收起差异',
  'diff.loading': '读取差异…',
  'diff.against': '与 v{n} 比较',
  'diff.first': '这是第一版，整篇都是新增',
  'diff.truncated': '差异过长，只显示前一部分',
  'diff.added': '新增 {n} 行',
  'diff.removed': '删除 {n} 行',
  'state.managed': '家族管理',
  'state.foreign': '非家族管理',
  'state.protected': '受保护',
  'state.unknown': '标记不可读',
  'action.baseline': '初始快照',
  'action.create': '新建',
  'action.patch': '定点修改',
  'action.update': '整篇更新',
  'action.restore': '回退',
  'action.delete': '删除（存的是被删的正文）',
  'action.archive': '归档（存的是被归档的正文）',
  'action.consolidate': '合并',
  'action.restructure': '结构调整',
  'action.support-write': '写入附带文件',
  'action.support-remove': '删除附带文件',
  'action.other': '其他写入',
  'time.now': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.minutes.one': '1 分钟前',
  'time.hours': '{n} 小时前',
  'time.hours.one': '1 小时前',
  'time.days': '{n} 天前',
  'time.days.one': '1 天前',
  'time.months': '{n} 个月前',
  'time.months.one': '1 个月前',
  'time.years': '{n} 年前',
  'time.years.one': '1 年前',
  error: '读取失败',
  'error.hint': '面板读不到宿主路由：通常是插件版本与宿主不匹配，重启 dsh web 后重试。',
}

/** English dictionary: the same keys, or the panel falls back to the key itself. */
export const en: Record<string, string> = {
  'entry.label': 'Skill history',
  title: 'Skill history',
  hint: 'The content versions every skill write leaves behind. Restoring changes the SKILL.md body only: markers, usage counts and curation state stay as they are.',
  'hint.current': 'Versions holding the same content are all marked “current”.',
  search: 'Filter by name or description',
  'search.none': 'No skill matches.',
  'group.content': 'Body versions',
  'group.support': 'File versions (not restorable)',
  'group.support.note': 'Support-file bytes share this index with the body; restoring the body does not bring them back.',
  'empty.skills': 'No skill has recorded a content version yet.',
  'empty.versions': 'This skill has no recorded versions.',
  loading: 'Loading…',
  refresh: 'Refresh',
  undo: 'Restore this version',
  'undo.confirm': 'Confirm restore',
  'undo.no': 'Cancel',
  current: 'Current',
  'versions.count': 'versions',
  'row.first': 'First version',
  'row.summary.missing': '(no summary generated)',
  'row.delta.up': '(+{n} chars)',
  'row.delta.down': '(-{n} chars)',
  'diff.show': 'Diff',
  'diff.hide': 'Hide diff',
  'diff.loading': 'Loading the diff…',
  'diff.against': 'compared with v{n}',
  'diff.first': 'first version: everything is new',
  'diff.truncated': 'the change is long; only its beginning is shown',
  'diff.added': '{n} lines added',
  'diff.removed': '{n} lines removed',
  'state.managed': 'family-managed',
  'state.foreign': 'not family-managed',
  'state.protected': 'protected',
  'state.unknown': 'marker unreadable',
  'action.baseline': 'initial snapshot',
  'action.create': 'created',
  'action.patch': 'targeted edit',
  'action.update': 'whole-body update',
  'action.restore': 'restored',
  'action.delete': 'deleted (holds the removed body)',
  'action.archive': 'archived (holds the archived body)',
  'action.consolidate': 'merged',
  'action.restructure': 'restructured',
  'action.support-write': 'support file written',
  'action.support-remove': 'support file removed',
  'action.other': 'other write',
  'time.now': 'just now',
  'time.minutes': '{n} minutes ago',
  'time.minutes.one': '1 minute ago',
  'time.hours': '{n} hours ago',
  'time.hours.one': '1 hour ago',
  'time.days': '{n} days ago',
  'time.days.one': '1 day ago',
  'time.months': '{n} months ago',
  'time.months.one': '1 month ago',
  'time.years': '{n} years ago',
  'time.years.one': '1 year ago',
  error: 'Could not load',
  'error.hint': 'The panel could not reach the host routes — usually a plugin/host version mismatch; restart dsh web and retry.',
}

/**
 * One message without the locale seat (the fallback path, and what a spec reads).
 * @param language - which dictionary to read.
 * @param key - the message key.
 * @returns the copy, or the key itself when neither dictionary carries it.
 */
export function message(language: 'zh' | 'en', key: string): string {
  const dictionary = language === 'en' ? en : zh
  return dictionary[key] ?? key
}

/**
 * Fill one TEMPLATE’s `{n}` slots. The seat resolves the key, this fills it, so the panel needs
 * only the seat plus this rule and never learns which language it is rendering.
 * @param template - the copy, with `{slot}` placeholders.
 * @param values - the substitutions, keyed by the slot name inside the braces.
 * @returns the filled copy.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, slot: string) => {
    const value = values[slot]
    return value === undefined ? match : String(value)
  })
}
