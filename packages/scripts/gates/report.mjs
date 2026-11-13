#!/usr/bin/env node
/**
 * gates/report — the VerdictRecord contract, the summary renderer, and the exit policy.
 *
 * One record per check. The four states never collapse; a fail says whether the CHECK'S OWN
 * invariant was evaluated, and which cause fired. The legal combinations are a closed set. The
 * runner's own failures (executor threw, scheduler blocked) are cannot-decide kinds, not contract
 * violations, so a record never loses its real cause.
 */

export const STATES = ['pass', 'fail', 'cannot-decide', 'skipped']
export const FAIL_UNEVALUATED_KINDS = ['budget-timeout', 'requires-abort']
export const FAIL_EVALUATED_KINDS = ['invariant-violation', 'non-zero-exit']
// `timeout` is the ROW's own budget. `internal-error` and `prerequisite-blocked` are produced by the
// runner/scheduler: the check was not evaluated, so they belong to the cannot-decide set (A1 fix).
export const CANNOT_DECIDE_KINDS = [
  'target-not-built', 'filter-no-match', 'artifact-absent', 'field-absent', 'unknown-combination',
  'unknown-errno', 'external-signal', 'adapter-absent', 'external-missing', 'produced-missing',
  'schema-inconsistent', 'no-release-tag', 'timeout', 'internal-error', 'prerequisite-blocked',
]
export const IDENTITY_FIELDS = ['face', 'channel', 'platformLine', 'adapterSha', 'policySha', 'familyVersion', 'readerSha', 'scope', 'tree', 'lane', 'ci']
export const CI = ['on', 'off']
export const CISC = ['on', 'off', 'mixed']

/** Exit codes are a contract: 3 names a broken record, not a failed check. */
export const EXIT = Object.freeze({ pass: 0, fail: 1, cannotDecide: 2, contract: 3 })

/** Validate one record; returns violations, each naming its full key path. */
export function validate(record, path = 'record') {
  const v = []
  if (!STATES.includes(record?.verdict)) v.push(path + '.verdict must be one of ' + STATES.join('|'))
  for (const field of ['id', 'check', 'criterion']) {
    if (typeof record?.[field] !== 'string' || record[field].trim() === '') v.push(path + '.' + field + ' is required (empty or missing)')
  }
  if (typeof record?.criterionEvaluated !== 'boolean') v.push(path + '.criterionEvaluated must be boolean')
  const kind = record?.cause?.kind
  // An unevaluated pass is not a weaker pass - it is not a verdict at all.
  if (record?.verdict === 'pass' && record.criterionEvaluated !== true) {
    v.push(path + '.criterionEvaluated must be true when verdict=pass (an unevaluated check cannot pass)')
  }
  if (record?.verdict === 'fail') {
    if (record.criterionEvaluated === true && !FAIL_EVALUATED_KINDS.includes(kind)) v.push(path + '.cause.kind must be one of ' + FAIL_EVALUATED_KINDS.join('|') + ' when verdict=fail and criterionEvaluated=true (got ' + String(kind) + ')')
    if (record.criterionEvaluated === false && !FAIL_UNEVALUATED_KINDS.includes(kind)) v.push(path + '.cause.kind must be one of ' + FAIL_UNEVALUATED_KINDS.join('|') + ' when verdict=fail and criterionEvaluated=false (got ' + String(kind) + ')')
  }
  if (record?.verdict === 'cannot-decide') {
    if (record.criterionEvaluated !== false) v.push(path + '.criterionEvaluated must be false when verdict=cannot-decide (the invariant was not evaluated)')
    if (!CANNOT_DECIDE_KINDS.includes(kind)) v.push(path + '.cause.kind must be one of the cannot-decide set (got ' + String(kind) + ')')
  }
  if (['fail', 'cannot-decide'].includes(record?.verdict)) {
    if (typeof record?.next !== 'string' || record.next.trim() === '') v.push(path + '.next is required for ' + record.verdict + ' (a red that does not say what to fix is not actionable)')
    if (typeof record?.evidence !== 'string' || record.evidence.trim() === '') v.push(path + '.evidence is required for ' + record.verdict)
  }
  const identity = record?.identity
  if (identity === undefined) v.push(path + '.identity is required (a reading without its configuration is not comparable)')
  else {
    for (const field of IDENTITY_FIELDS) {
      if (typeof identity[field] !== 'string' || identity[field].trim() === '') v.push(path + '.identity.' + field + ' is required')
    }
    if (!CI.includes(identity.ci)) v.push(path + '.identity.ci must be on|off (got ' + String(identity.ci) + ')')
  }
  return v
}

/** Four-key counts; sum(counts) === records.length is the invariant callers assert. */
export function counts(records) {
  const c = { pass: 0, fail: 0, cannotDecide: 0, skipped: 0 }
  for (const record of records) {
    if (record.verdict === 'pass') c.pass += 1
    else if (record.verdict === 'fail') c.fail += 1
    else if (record.verdict === 'cannot-decide') c.cannotDecide += 1
    else if (record.verdict === 'skipped') c.skipped += 1
  }
  return c
}

/** Exit policy: a broken record outranks any verdict; a fail outranks cannot-decide. */
export function exitCodeFor({ counts: c, violations = [], unregisteredCannotDecide = 0 }) {
  if (violations.length > 0) return EXIT.contract
  if (c.fail > 0) return EXIT.fail
  if (c.pass === 0) return EXIT.cannotDecide
  if (unregisteredCannotDecide > 0) return EXIT.cannotDecide
  return EXIT.pass
}

/** The human line: judgement | object | real path | exit semantics, plus missing= when known. */
export function render(record) {
  const word = { pass: '[通过]', fail: '[失败]', 'cannot-decide': '[无法判定]', skipped: '[跳过]' }[record.verdict] ?? '[?]'
  const subject = record.subject === undefined ? 'object=?' : record.subject.kind + '(' + String(record.subject.count ?? 0) + ')'
  const path = record.path === undefined ? 'path=UNRESOLVED' : 'path=' + record.path
  const exit = record.verdict === 'pass' ? 0 : record.verdict === 'fail' ? 1 : record.verdict === 'cannot-decide' ? 2 : undefined
  const missing = record.missing === undefined || record.missing.length === 0 ? '' : ' missing=' + record.missing.join(',')
  return word + ' ' + record.id + ' check=' + record.check + ' criterion=' + record.criterion + ' ' + subject + ' ' + path + ' exit=' + String(exit) + missing
}

/** The action block for fail/cannot-decide (three lines at most, indented like the CLI prints it). */
export function actionBlock(record) {
  if (!['fail', 'cannot-decide'].includes(record.verdict)) return []
  const lines = ['           next: ' + record.next, '           evidence: ' + record.evidence]
  if (typeof record.rerun === 'string' && record.rerun.trim() !== '') lines.push('           rerun: ' + record.rerun)
  return lines
}
