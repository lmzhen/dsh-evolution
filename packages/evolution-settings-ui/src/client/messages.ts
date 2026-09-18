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
  subtitle: '审查／记忆／策展／技能四个命名空间的参数可在用户层覆盖；此处只列可改项，其余仍由部署面决定。',
  overridden: '用户',
  deployment: '部署',
  loading: '正在读取设置文档…',
  unavailable: '这个命名空间没有宿主提供服务（对应插件行未挂载）',
  readonly: '本次会话的设置文档是只读的（内存模式）',
  apply: '保存',
  reset: '恢复部署默认',
  empty: '这个命名空间没有可改项',
} as const

/** English copy, key for key with {@link zh}. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Self-evolution',
  subtitle: 'Parameters of the review, memory, curation and skill namespaces may be overridden per user; only the writable ones are listed here, everything else still comes from the deployment.',
  overridden: 'user',
  deployment: 'deployment',
  loading: 'reading the settings document…',
  unavailable: 'this namespace is not served by the Host (its owning plugin row is not mounted)',
  readonly: 'the settings document is read-only in this session (memory mode)',
  apply: 'Save',
  reset: 'Reset to deployment',
  empty: 'no writable field in this namespace',
}

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
