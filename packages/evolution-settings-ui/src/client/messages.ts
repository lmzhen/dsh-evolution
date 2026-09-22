/**
 * Copy for the evolution settings section and its parameter cards.
 *
 * The section is registered through the platform's locale seat (`ctx.locale`),
 * which is the same route the other out-of-repo client plugins take. The earlier
 * note in this package's README — that an outside package cannot bind the locale
 * seat — is wrong: `locale.register(namespace, { zh, en })` is the documented
 * call, and it is what makes the section title and its copy follow the UI
 * language instead of shipping one hard-coded dictionary.
 */

/** Locale namespace this bundle registers. */
export const NS = 'evolution-settings'

/** Chinese copy (the family's primary language). */
export const zh = {
  title: '自进化',
  subtitle: '下面按功能列出你能改的参数；没有列出的由安装时的配置决定。',
  overridden: '我改过',
  deployment: '默认',
  loading: '正在读取设置…',
  unavailable: '这个功能没有启动（对应的插件没有安装）',
  readonly: '本次会话不允许写入设置（临时运行模式）',
  apply: '保存',
  reset: '恢复默认值',
  empty: '这里没有可改项',
  changed: '{n} 项已改',
  discard: '放弃修改',
  saving: '保存中…',
  refused: '这个值没有被接受（界面上保持原样）。想看原因：运行 /evolution params 或 /evolution doctor。',
  cardReview: '会话回顾',
  cardMemory: '长期记忆',
  cardToolMemory: '记忆写入',
  cardCurator: '技能整理',
  cardSkills: '技能写入规则',
} as const

/** English copy, key for key with {@link zh}. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Self-evolution',
  subtitle: 'Changeable parameters are listed by feature below; anything not listed comes from the deployment configuration.',
  overridden: 'edited by you',
  deployment: 'default',
  loading: 'reading settings…',
  unavailable: 'this feature is not running (its plugin is not installed)',
  readonly: 'settings cannot be written in this session (temporary mode)',
  apply: 'Save',
  reset: 'Reset to default',
  empty: 'nothing to change here',
  changed: '{n} changed',
  discard: 'Discard',
  saving: 'Saving…',
  refused: 'The value was not accepted (the page keeps what you see). For the reason run /evolution params or /evolution doctor.',
  cardReview: 'Session review',
  cardMemory: 'Long-term memory',
  cardToolMemory: 'Writing memory',
  cardCurator: 'Skill tidy-up',
  cardSkills: 'Skill write rules',
}

/**
 * Card titles per settings namespace. A namespace without an entry falls back to
 * its raw name, so a Host that registers a new namespace still renders — the
 * title is presentation, the namespace is the join key.
 */
export const NAMESPACE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  'evolution-review': 'cardReview',
  'evolution-memory': 'cardMemory',
  'evolution-tool-memory': 'cardToolMemory',
  'evolution-curator': 'cardCurator',
  'evolution-skills': 'cardSkills',
})

/** One message key. */
export type MessageKey = keyof typeof zh

/**
 * Resolve one message without the locale seat (tests and the fallback path).
 * @param key - the message key.
 * @param language - which dictionary to read; defaults to Chinese.
 * @returns the copy this bundle carries.
 */
export function message(key: MessageKey, language: 'zh' | 'en' = 'zh'): string {
  return language === 'zh' ? zh[key] : en[key]
}
