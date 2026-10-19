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
  overridden: '已覆盖',
  deployment: '默认',
  loading: '正在读取设置…',
  unavailable: '这个功能没有启动（对应的插件没有安装）',
  seatMissing: '这个界面没有提供设置服务，参数只能看不能改',
  projectionFailed: '这一块读设置时出错，已记入日志；其它参数不受影响',
  readonly: '本次会话不允许写入设置（临时运行模式）',
  apply: '保存',
  reset: '恢复默认值',
  empty: '这里没有可改项',
  changed: '{n} 项已覆盖',
  discard: '放弃修改',
  saving: '保存中…',
  resetting: '恢复中…',
  writeTargetHost: '保存去向：宿主配置（对所有会话生效）',
  invalidNumber: '需要一个数字',
  invalidSelect: '不在允许的取值里',
  invalidAtLeast: '不能小于同组的 {n}',
  approvalConfirmNamed: '即将批准：{n}',
  approvalConfirmYes: '确认批准',
  approvalConfirmNo: '取消',
  resetTo: '复位为 {value}',
  refused: '这个值没有被接受（界面上保持原样）。想看原因：在对话里让它说明。',
  resetRefused: '恢复默认值没有生效（这一行还是你的值）。想看原因：在对话里让它说明。',
  cardReview: '会话回顾',
  cardMemory: '长期记忆',
  cardToolMemory: '记忆写入',
  cardCurator: '技能整理',
  cardSkills: '技能写入规则',
  cardApproval: '写入审批',
  cardCommands: '维护扫描',
  approvalTitle: '待批写入',
  approvalLoading: '正在读取待批项…',
  approvalEmpty: '没有待批的写入',
  approvalFailed: '待批项读取失败',
  approvalRetry: '重试',
  approvalApprove: '批准',
  approvalReject: '拒绝',
  approvalCount: '{n} 项待批',
  approvalRunningCount: '{n} 项执行中',
  approvalRefresh: '刷新',
  approvalExecuting: '执行中：这条的写效果可能已经落地，不要重复批准；要清掉它请用拒绝。',
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
  diagTitle: '诊断',
  diagSubtitle: '运行状态的只读自查；不会改动任何东西。',
  diagRuntimeTitle: '运行状态',
  diagSummaryOk: '运行正常',
  diagSummaryWarn: '{n} 项需要注意',
  diagSummaryFail: '{n} 项异常',
  diagSummaryUnknown: '{n} 项待确认',
  diagRefresh: '刷新',
  diagRefreshing: '刷新中…',
  diagStatusOk: '正常',
  diagStatusWarn: '注意',
  diagStatusFail: '异常',
  diagStatusUnknown: '未知',
  diagRemedy: '建议：',
  diagNoRows: '没有可显示的运行状态',
  stateLoading: '正在读取…',
  failureUnauthorized: '需要登录：重新打开这个页面完成登录后再试。',
  failureForbidden: '平台拒绝了这个请求（身份不是 owner）。',
  failureUnmounted: '该功能没有挂载。',
  failureServer: '读取失败，可以手动重试。',
  fallbackHint: '可以改用命令：{command}',
} as const

/** English copy, key for key with {@link zh}. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Self-evolution',
  subtitle: 'Writes waiting for your decision come first; the changeable parameters are listed by feature below, and anything not listed comes from the deployment configuration.',
  overridden: 'Overridden',
  deployment: 'default',
  loading: 'reading settings…',
  unavailable: 'this feature is not running (its plugin is not installed)',
  seatMissing: 'this shell serves no settings surface, so the parameters cannot be edited here',
  projectionFailed: 'reading this row failed and the error is in the log; the other parameters are unaffected',
  readonly: 'settings cannot be written in this session (temporary mode)',
  apply: 'Save',
  reset: 'Reset to default',
  empty: 'nothing to change here',
  changed: '{n} overridden',
  discard: 'Discard',
  saving: 'Saving…',
  resetting: 'Resetting…',
  writeTargetHost: 'Saved to: host configuration (applies to every session)',
  invalidNumber: 'Needs a number',
  invalidSelect: 'Not one of the allowed values',
  invalidAtLeast: 'must not be below {n}',
  approvalConfirmNamed: 'About to approve: {n}',
  approvalConfirmYes: 'Approve',
  approvalConfirmNo: 'Cancel',
  resetTo: 'Restores {value}',
  refused: 'The value was not accepted (the page keeps what you see). For the reason, ask in the conversation.',
  resetRefused: 'The reset did not take (this row still holds your value). For the reason, ask in the conversation.',
  cardReview: 'Session review',
  cardMemory: 'Long-term memory',
  cardToolMemory: 'Writing memory',
  cardCurator: 'Skill tidy-up',
  cardSkills: 'Skill write rules',
  cardApproval: 'Write approval',
  cardCommands: 'Maintenance scans',
  approvalTitle: 'Writes awaiting approval',
  approvalLoading: 'reading the pending window…',
  approvalEmpty: 'nothing is waiting for a decision',
  approvalFailed: 'the pending window could not be read',
  approvalRetry: 'Retry',
  approvalApprove: 'Approve',
  approvalReject: 'Reject',
  approvalCount: '{n} waiting',
  approvalRunningCount: '{n} running',
  approvalRefresh: 'Refresh',
  approvalExecuting: 'Running: this write may already have landed — do not approve it twice; reject it to clear it.',
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
  diagTitle: 'Diagnostics',
  diagSubtitle: 'A read-only check of the runtime state; nothing here changes anything.',
  diagRuntimeTitle: 'Runtime status',
  diagSummaryOk: 'All healthy',
  diagSummaryWarn: '{n} need attention',
  diagSummaryFail: '{n} failing',
  diagSummaryUnknown: '{n} unconfirmed',
  diagRefresh: 'Refresh',
  diagRefreshing: 'refreshing…',
  diagStatusOk: 'healthy',
  diagStatusWarn: 'needs attention',
  diagStatusFail: 'failing',
  diagStatusUnknown: 'unknown',
  diagRemedy: 'Suggested: ',
  diagNoRows: 'no runtime status to show',
  stateLoading: 'reading…',
  failureUnauthorized: 'Sign-in is required: reopen this page and sign in, then retry.',
  failureForbidden: 'The platform refused this request (not the owner principal).',
  failureUnmounted: 'This feature is not mounted.',
  failureServer: 'The read failed; you can retry manually.',
  fallbackHint: 'Command fallback: {command}',
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
  'evolution-approval': 'cardApproval',
  'evolution-commands': 'cardCommands',
})

/** One message key. */
export type MessageKey = keyof typeof zh

/**
 * Resolve one message without the locale seat (tests and the fallback path).
 * @param key - the message key.
 * @param language - which dictionary to read; defaults to English (the platform FALLBACK_LOCALE).
 * @returns the copy this bundle carries.
 */
export function message(key: MessageKey, language: 'zh' | 'en' = 'en'): string {
  return language === 'zh' ? zh[key] : en[key]
}

/**
 * Fill one TEMPLATE's `{slot}` placeholders (G5 C4). The seat's translator takes the values, so the
 * rule lives here instead of at every call site — `t('changed').replace('{n}', …)` used to be
 * written seven times across three components. An UNKNOWN slot is left standing: a missing value
 * must not print "undefined" into the operator's UI.
 * @param template - the resolved copy, with `{slot}` placeholders.
 * @param values - substitutions keyed by the slot name inside the braces.
 * @returns the filled copy.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, slot: string) => {
    const value = values[slot]
    return value === undefined ? match : String(value)
  })
}

/**
 * Resolve one message and fill its slots in one step: exactly what the seat's `t` does (G5 C4),
 * for specs and stand-alone callers that hold no seat.
 * @param key - the copy key.
 * @param values - substitutions, or undefined for the plain copy.
 * @returns the copy a reader sees.
 */
export function formatText(key: MessageKey, values?: Readonly<Record<string, string | number>>): string {
  const text = message(key)
  return values === undefined ? text : fill(text, values)
}
