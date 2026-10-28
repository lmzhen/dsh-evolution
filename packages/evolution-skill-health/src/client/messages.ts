/**
 * Panel copy, in a zh/en dictionary registered through the platform's locale seat.
 *
 * Client copy is locale-owned: the entry label, the group headings, the verdict words, the empty
 * and failure lines all resolve here, and the panel carries no literal string of its own. Facts come
 * from the host; only the WORDS live here. Two lines exist to keep silence honest: a rule whose
 * threshold is NOT calibrated is named without a number, and an unreadable skill is never a pass.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

/** The locale namespace this bundle registers. */
export const NS = 'evolution-skill-health'

/** Chinese dictionary. */
export const zh: Record<string, string> = {
  'entry.label': '技能健康',
  'title': '技能健康',
  'hint': '体检引擎的结论，按规则聚合。未标定的阈值只报规则名、不报数字；读不到的技能按「不可读」列出，不当作没问题。',
  'refresh': '刷新',
  'loading': '读取中…',
  'group.byRule': '按规则',
  'group.bySkill': '按技能',
  'verdict.ok': '正常',
  'verdict.warn': '警告',
  'verdict.needs-restructure': '需重构',
  'verdict.error': '错误',
  'verdict.unreadable': '不可读',
  'group.proposals': '语义提议',
  'proposal.unavailable': '提议源未挂载；这不是「没有可拆项」。',
  'proposal.outcome.keep': '保持',
  'proposal.outcome.extract': '提取',
  'proposal.outcome.mixed': '混合',
  'proposal.outcome.owner-gap': 'owner 缺口',
  'proposal.owner.covered': '有覆盖 owner',
  'proposal.owner.owner-gap': '无覆盖 owner',
  'counts': '{ok} 正常 · {warn} 警告 · {error} 错误 · {unreadable} 不可读',
  'col.rule': '规则',
  'col.skills': '涉及技能',
  'col.count': '次数',
  'count.notCalibrated': '未标定',
  'empty': '没有可报告的结论。',
  'empty.noneReported': '本次没有降级项——这不等于每个技能都可读。',
  'line': '位置：{path}',
  'line.unknown': '位置：未知',
  'unreadable.note': '读不到内容，因此无法判断（不是「通过」）。',
  'scan.truncated': '本次扫描不完整，计数是下界；请刷新后重试。',
  'loading.failed': '读取失败——现在判断不了；点「刷新」重试。',
  'read.failed': '这次没读到数据（下面一行是原始信息）：',
  'failure.unauthorized': '需要登录：重新打开这个页面完成登录后再试。',
  'failure.forbidden': '平台拒绝了这个请求（身份不是 owner）。',
  'failure.unmounted': '该功能没有挂载。',
  'failure.server': '读取失败，可以重试。',
  'fallback.hint': '可以改用命令：{command}',
}

/** English dictionary. */
export const en: Record<string, string> = {
  'read.failed': 'This read failed (raw message below):',
  'entry.label': 'Skill Health',
  'title': 'Skill Health',
  'hint': 'What the health engine found, aggregated by rule. A rule whose threshold is not calibrated yet is named without a number; skills that cannot be read are listed as unreadable, never as fine.',
  'refresh': 'Refresh',
  'loading': 'Loading…',
  'group.byRule': 'By rule',
  'group.bySkill': 'By skill',
  'verdict.ok': 'OK',
  'verdict.warn': 'Warn',
  'verdict.needs-restructure': 'Needs restructure',
  'verdict.error': 'Error',
  'verdict.unreadable': 'Unreadable',
  'group.proposals': 'Semantic proposals',
  'proposal.unavailable': 'No proposal source is mounted; this is not "nothing to extract".',
  'proposal.outcome.keep': 'keep',
  'proposal.outcome.extract': 'extract',
  'proposal.outcome.mixed': 'mixed',
  'proposal.outcome.owner-gap': 'owner-gap',
  'proposal.owner.covered': 'covered owner',
  'proposal.owner.owner-gap': 'no covering owner',
  'counts': '{ok} ok · {warn} warn · {error} error · {unreadable} unreadable',
  'col.rule': 'Rule',
  'col.skills': 'Skills',
  'col.count': 'Count',
  'count.notCalibrated': 'not calibrated',
  'empty': 'Nothing to report.',
  'empty.noneReported': 'No degraded row was reported — this does NOT assert that every skill is readable.',
  'line': 'line: {path}',
  'line.unknown': 'line: UNKNOWN',
  'unreadable.note': 'The content could not be read, so this cannot be judged (it is not a pass).',
  'scan.truncated': 'This scan is incomplete; the counts are a lower bound. Press Refresh to retry.',
  'loading.failed': 'Reading failed — this cannot be judged right now; press Refresh to retry.',
  'failure.unauthorized': 'Sign-in is required: reopen this page and sign in, then retry.',
  'failure.forbidden': 'The platform refused this request (not the owner principal).',
  'failure.unmounted': 'This feature is not mounted.',
  'failure.server': 'The read failed; you can retry.',
  'fallback.hint': 'Command fallback: {command}',
}
