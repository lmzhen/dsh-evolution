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
  'group.write': '写入与审批',
  'group.organize': '自动整理',
  'group.memory': '记忆与回顾',
  subtitle: '待你决定的写入在最上面；下面按功能列出你能改的参数，没有列出的由安装时的配置决定。',
  aboutPurpose: '自进化设置与技能历史',
  overridden: '已修改',
  deployment: '默认',
  loading: '正在读取设置…',
  unavailable: '这个功能没有启动（对应的插件没有安装）',
  seatMissing: '这个界面没有提供设置服务，参数只能看不能改',
  projectionFailed: '这一块读设置时出错，已记入日志；其它参数不受影响',
  readonly: '本次会话不允许写入设置（临时运行模式）',
  apply: '保存',
  reset: '恢复默认',
  empty: '这里没有可改项',
  changed: '{n} 项已修改',
  discard: '放弃修改',
  saving: '保存中…',
  resetting: '恢复中…',
  writeTargetHost: '保存位置：插件配置（对所有会话生效）',
  invalidNumber: '需要一个数字',
  invalidSelect: '不在允许的取值里',
  invalidAtLeast: '不能小于「{field}」的 {n}{unit}',
  invalidAtLeastPeer: '同组设置',
  approvalConfirmNamed: '即将批准：{n}',
  approvalRawSummary: '原始摘要',
  approvalConfirmYes: '确认批准',
  approvalConfirmNo: '取消',
  resetTo: '恢复为 {value}',
  saved: '已保存。',
  saveReadbackFailed: '写入已被接受，但回读失败；点刷新重读后再确认。',
  readbackStale: '显示的是最后一次成功读取的值；当前回读失败，刷新后可能变化。',
  saveConflict: '这个值没有被接受：设置已被其他页面修改。请重读后再保存。',
  resetDone: '已恢复默认值。',
  refused: '这个值没有被接受（页面上保持原样）。想知道原因：在对话里问它。',
  resetRefused: '恢复默认没有生效（这一行还是你的值）。想知道原因：在对话里问它。',
  cardReview: '会话回顾',
  cardMemory: '长期记忆',
  cardToolMemory: '记忆写入',
  cardCurator: '技能整理',
  cardSkills: '技能写入规则',
  cardApproval: '写入审批',
  cardCommands: '维护扫描',
  cardMerge: '技能自动合并',
  approvalCardHint: '技能在使用中生成或修改内容时，先放进待批清单，由你确认。',
  mergeCardHint: '两个技能被判重复后，第一轮结束先停下，等你批准再合并。',
  approvalTitle: '待批写入',
  approvalLoading: '正在读取待批项…',
  approvalEmpty: '没有待处理的写入',
  approvalEmptyDescription: '当前没有需要你确认的技能变更。\n有新的写入时，会在这里显示来源、内容和影响范围。',
  approvalHistory: '查看技能历史',
  approvalFactKind: '类型',
  approvalFactAge: '时间',
  approvalFactTarget: '对象',
  approvalFailed: '待批项读取失败',
  approvalRetry: '重试',
  approvalApprove: '批准',
  approvalReject: '拒绝',
  approvalCount: '{n} 项待批',
  approvalRunningCount: '{n} 项执行中',
  approvalRefresh: '刷新',
  approvalApproving: '批准中…',
  approvalRejecting: '拒绝中…',
  approvalExecuting: '正在执行：改动可能已经生效，别重复批准。先确认结果，再用「放回待批」释放占用；释放不会停止或撤销正在进行的写入。',
  approvalRelease: '放回待批',
  approvalReleasing: '释放中…',
  approvalKindMemory: '记忆',
  approvalKindSkill: '技能',
  approvalKindCapability: '能力',
  approvalVerbAdd: '新增',
  approvalVerbCreate: '创建',
  approvalVerbUpdate: '更新',
  approvalVerbRemove: '移除',
  approvalVerbDelete: '删除',
  approvalVerbArchive: '归档',
  approvalVerbRestore: '恢复',
  approvalVerbMerge: '合并',
  approvalAgeNow: '刚刚',
  approvalAgeMinutes: '{n} 分钟前',
  approvalAgeHours: '{n} 小时前',
  approvalAgeDays: '{n} 天前',
  approvalAgeMonths: '{n} 个月前',
  approvalPreview: '预览',
  approvalPreviewClose: '收起',
  approvalPreviewReading: '正在读取预览…',
  approvalPreviewNone: '暂时看不了预览：',
  approvalPreviewPath: '文件：{path}',
  approvalDiffAdded: '{n} 行新增',
  approvalDiffRemoved: '{n} 行删除',
  approvalDiffCut: '改动区域已截断',
  diagTitle: '诊断',
  diagSubtitle: '运行状态的只读自查；不会改动任何东西。',
  diagRuntimeTitle: '运行状态',
  diagComplete: '没有需要处理的异常',
  diagOtherIssues: '其他 {n} 项异常',
  diagNormal: '其他 {n} 项正常',
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
  diagRecheck: '重新检查',
  diagCopyRemedy: '复制修复命令',
  diagCopied: '修复命令已复制',
  diagCopyFailed: '复制失败；请手动执行上方命令',
  diagNoRows: '没有可显示的运行状态',
  diagPurpose: '用途：检查插件、平台服务和数据连接是否正常；这里不会修改任何东西。',
  diagFooter: '诊断数据 v{version} · 生成于 {at}',
  timeToday: '今天',
  diagFooterToday: '诊断数据 v{version} · 今天 {at} 生成',
  stateLoading: '正在读取…',
  failureUnauthorized: '需要登录：重新打开这个页面完成登录后再试。',
  failureForbidden: '平台拒绝了这个请求（当前身份没有权限）。',
  failureUnmounted: '这个功能没有启用。',
  failureServer: '读取失败，可以手动重试。',
  fallbackHint: '可以改用命令：{command}',
} as const

/** English copy, key for key with {@link zh}. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Self-evolution',
  'group.write': 'Writes and approval',
  'group.organize': 'Automatic tidy-up',
  'group.memory': 'Memory and review',
  subtitle: 'Writes waiting for your decision come first; the changeable parameters are listed by feature below, and anything not listed comes from the deployment configuration.',
  aboutPurpose: 'Self-evolution settings and skill history',
  overridden: 'Modified',
  deployment: 'default',
  loading: 'reading settings…',
  unavailable: 'this feature is not running (its plugin is not installed)',
  seatMissing: 'this shell serves no settings surface, so the parameters cannot be edited here',
  projectionFailed: 'reading this row failed and the error is in the log; the other parameters are unaffected',
  readonly: 'settings cannot be written in this session (temporary mode)',
  apply: 'Save',
  reset: 'Restore default',
  empty: 'nothing to change here',
  changed: '{n} modified',
  discard: 'Discard',
  saving: 'Saving…',
  resetting: 'Restoring…',
  writeTargetHost: 'Saved to: plugin config (applies to all sessions)',
  invalidNumber: 'Needs a number',
  invalidSelect: 'Not one of the allowed values',
  invalidAtLeast: 'must not be below {field}: {n}{unit}',
  invalidAtLeastPeer: 'the related setting',
  approvalConfirmNamed: 'About to approve: {n}',
  approvalRawSummary: 'Raw summary',
  approvalConfirmYes: 'Approve',
  approvalConfirmNo: 'Cancel',
  resetTo: 'Restore to {value}',
  saved: 'Saved.',
  saveReadbackFailed: 'The write was accepted, but reading it back failed; refresh and confirm.',
  readbackStale: 'Showing the last successfully read values; the current re-read failed and may change after refresh.',
  saveConflict: 'The value was not accepted: settings changed in another page. Re-read before saving again.',
  resetDone: 'Default restored.',
  refused: 'This value was not accepted (the page keeps what you see). To find out why, ask in the conversation.',
  resetRefused: 'Restoring the default did not take effect (the row still holds your value). To find out why, ask in the conversation.',
  cardReview: 'Session review',
  cardMemory: 'Long-term memory',
  cardToolMemory: 'Writing memory',
  cardCurator: 'Skill tidy-up',
  cardSkills: 'Skill write rules',
  cardApproval: 'Write approval',
  cardCommands: 'Maintenance scans',
  cardMerge: 'Skill auto-merge',
  approvalCardHint: 'When a skill is created or changed while in use, the write waits in the pending list for your decision.',
  mergeCardHint: 'When two skills look duplicated, the first round stops and waits for your approval before merging.',
  approvalTitle: 'Writes awaiting approval',
  approvalLoading: 'reading the pending window…',
  approvalEmpty: 'Nothing is waiting',
  approvalEmptyDescription: 'There are no skill changes to confirm.\nNew writes will show their source, content and impact here.',
  approvalHistory: 'View skill history',
  approvalFactKind: 'Kind',
  approvalFactAge: 'Time',
  approvalFactTarget: 'Target',
  approvalFailed: 'the pending window could not be read',
  approvalRetry: 'Retry',
  approvalApprove: 'Approve',
  approvalReject: 'Reject',
  approvalCount: '{n} waiting',
  approvalRunningCount: '{n} running',
  approvalRefresh: 'Refresh',
  approvalApproving: 'approving…',
  approvalRejecting: 'rejecting…',
  approvalExecuting: 'Running: the change may already have taken effect; do not approve it again. Check the result first, then use "Back to pending" to free it; that does not stop or undo the write in progress.',
  approvalRelease: 'Release',
  approvalReleasing: 'releasing…',
  approvalKindMemory: 'memory',
  approvalKindSkill: 'skill',
  approvalKindCapability: 'capability',
  approvalVerbAdd: 'add',
  approvalVerbCreate: 'create',
  approvalVerbUpdate: 'update',
  approvalVerbRemove: 'remove',
  approvalVerbDelete: 'delete',
  approvalVerbArchive: 'archive',
  approvalVerbRestore: 'restore',
  approvalVerbMerge: 'merge',
  approvalAgeNow: 'just now',
  approvalAgeMinutes: '{n} min ago',
  approvalAgeHours: '{n} h ago',
  approvalAgeDays: '{n} d ago',
  approvalAgeMonths: '{n} mo ago',
  approvalPreview: 'Preview',
  approvalPreviewClose: 'Hide',
  approvalPreviewReading: 'reading the preview…',
  approvalPreviewNone: 'Preview is not available right now:',
  approvalPreviewPath: 'File: {path}',
  approvalDiffAdded: '{n} lines added',
  approvalDiffRemoved: '{n} lines removed',
  approvalDiffCut: 'the changed region is truncated',
  diagTitle: 'Diagnostics',
  diagSubtitle: 'A read-only check of the runtime state; nothing here changes anything.',
  diagRuntimeTitle: 'Runtime status',
  diagComplete: 'Nothing needs attention',
  diagOtherIssues: 'Other {n} issues',
  diagNormal: 'Other {n} normal checks',
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
  diagRecheck: 'Recheck',
  diagCopyRemedy: 'Copy fix command',
  diagCopied: 'Fix command copied',
  diagCopyFailed: 'Copy failed; run the command above manually',
  diagNoRows: 'no runtime status to show',
  diagPurpose: 'What it checks: plugins, platform services and data connections. Nothing is changed here.',
  diagFooter: 'Diagnostics data v{version} · generated {at}',
  timeToday: 'Today',
  diagFooterToday: 'Diagnostics data v{version} · generated today at {at}',
  stateLoading: 'reading…',
  failureUnauthorized: 'Sign-in is required: reopen this page and sign in, then retry.',
  failureForbidden: 'The platform refused this request (this account has no permission).',
  failureUnmounted: 'This feature is not enabled.',
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
  'evolution-merge': 'cardMerge',
})

/** One message key. */
export type MessageKey = keyof typeof zh

/**
 * Resolve one message without the locale seat (tests and the fallback path).
 * @param key - the message key.
 * @param language - which dictionary to read; defaults to zh, matching the platform FALLBACK_LOCALE.
 * @returns the copy this bundle carries.
 */
export function message(key: MessageKey, language: 'zh' | 'en' = 'zh'): string {
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
