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
  subtitle: '待你决定的写入在最上面；下面按功能列出你能改的参数，没有列出的由安装时的配置决定。',
  overridden: '我改过',
  deployment: '默认',
  loading: '正在读取设置…',
  unavailable: '这个功能没有启动（对应的插件没有安装）',
  seatMissing: '这个界面没有提供设置服务，参数只能看不能改',
  projectionFailed: '这一块读设置时出错，已记入日志；其它参数不受影响',
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
  approvalTitle: '待批写入',
  approvalLoading: '正在读取待批项…',
  approvalEmpty: '没有待批的写入',
  approvalFailed: '待批项读取失败',
  approvalRetry: '重试',
  approvalApprove: '批准',
  approvalReject: '拒绝',
  approvalCount: '{n} 项待批',
  approvalKindMemory: '记忆',
  approvalKindSkill: '技能',
  approvalKindCapability: '能力',
  approvalAgeNow: '刚刚',
  approvalAgeMinutes: '{n} 分钟前',
  approvalAgeHours: '{n} 小时前',
  approvalAgeDays: '{n} 天前',
  approvalAgeMonths: '{n} 个月前',
  approvalPreview: '预览',
  approvalPreviewClose: '收起',
  approvalPreviewReading: '正在读取预览…',
  approvalPreviewNone: '看不了预览：',
  approvalDiffAdded: '{n} 行新增',
  approvalDiffRemoved: '{n} 行删除',
  approvalDiffCut: '改动区域已截断',
} as const

/** English copy, key for key with {@link zh}. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Self-evolution',
  subtitle: 'Writes waiting for your decision come first; the changeable parameters are listed by feature below, and anything not listed comes from the deployment configuration.',
  overridden: 'edited by you',
  deployment: 'default',
  loading: 'reading settings…',
  unavailable: 'this feature is not running (its plugin is not installed)',
  seatMissing: 'this shell serves no settings surface, so the parameters cannot be edited here',
  projectionFailed: 'reading this row failed and the error is in the log; the other parameters are unaffected',
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
  approvalTitle: 'Writes awaiting approval',
  approvalLoading: 'reading the pending window…',
  approvalEmpty: 'nothing is waiting for a decision',
  approvalFailed: 'the pending window could not be read',
  approvalRetry: 'Retry',
  approvalApprove: 'Approve',
  approvalReject: 'Reject',
  approvalCount: '{n} waiting',
  approvalKindMemory: 'memory',
  approvalKindSkill: 'skill',
  approvalKindCapability: 'capability',
  approvalAgeNow: 'just now',
  approvalAgeMinutes: '{n} min ago',
  approvalAgeHours: '{n} h ago',
  approvalAgeDays: '{n} d ago',
  approvalAgeMonths: '{n} mo ago',
  approvalPreview: 'Preview',
  approvalPreviewClose: 'Hide',
  approvalPreviewReading: 'reading the preview…',
  approvalPreviewNone: 'no preview: ',
  approvalDiffAdded: '{n} lines added',
  approvalDiffRemoved: '{n} lines removed',
  approvalDiffCut: 'the changed region is truncated',
}

/**
 * Card titles per settings namespace. A namespace without an entry falls back to
 * its raw name, so a Host that registers a new namespace still renders — the
 * title is presentation, the namespace is the join key.
 */
export const NAMESPACE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  // Keyed by ROW ID (the platform's settings namespace is the Loader entry id); the
  // legacy namespace strings never appear here — see the registry's PARAM_NAMESPACES.
  'evolution-review': 'cardReview',
  'memory-files': 'cardMemory',
  'tool-memory': 'cardToolMemory',
  'evolution-curator': 'cardCurator',
  'tool-skill-manage': 'cardSkills',
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
