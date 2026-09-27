/**
 * Panel copy, in a zh/en dictionary registered through the platform's locale seat.
 *
 * Client copy is locale-owned: the entry label, the group headings, the actions and the status lines
 * all resolve here, and the panel carries no literal string of its own.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */

/** The locale namespace this bundle registers. */
export const NS = 'evolution-skill-history'

/** Chinese dictionary. */
export const zh: Record<string, string> = {
  'entry.label': '技能历史',
  title: '技能历史',
  hint: '每次技能写入留下的内容版本。回退只改 SKILL.md 正文，标记、使用计数与策展状态不变。',
  'group.content': '正文版本',
  'group.support': '文件版本（不可回退）',
  'group.support.note': '附带文件的字节与正文共用一份索引；回退不恢复它们。',
  'empty.skills': '还没有技能留下过内容版本。',
  'empty.versions': '这个技能还没有记录版本。',
  loading: '读取中…',
  refresh: '刷新',
  undo: '回退到此版',
  'undo.confirm': '确认回退到此版？',
  'undo.yes': '回退',
  'undo.no': '取消',
  current: '当前',
  error: '读取失败',
  versions: '个版本',
}

/** English dictionary: the same keys, or the panel falls back to the key itself. */
export const en: Record<string, string> = {
  'entry.label': 'Skill history',
  title: 'Skill history',
  hint: 'The content versions every skill write leaves behind. Restoring changes the SKILL.md body only: markers, usage counts and curation state stay as they are.',
  'group.content': 'Body versions',
  'group.support': 'File versions (not restorable)',
  'group.support.note': 'Support-file bytes share this index with the body; restoring the body does not bring them back.',
  'empty.skills': 'No skill has recorded a content version yet.',
  'empty.versions': 'This skill has no recorded versions.',
  loading: 'Loading…',
  refresh: 'Refresh',
  undo: 'Restore this version',
  'undo.confirm': 'Restore this version?',
  'undo.yes': 'Restore',
  'undo.no': 'Cancel',
  current: 'Current',
  error: 'Could not load',
  versions: 'versions',
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
