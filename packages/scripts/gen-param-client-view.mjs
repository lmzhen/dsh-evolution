#!/usr/bin/env node
/**
 * Generate the settings-UI package's parameter view (G4/S4.4).
 *
 * The browser half cannot import Host TypeScript, so the field list every card
 * renders comes from the SAME registry text the .mjs tools and PARAMETERS.md
 * read: lib-param-registry.mjs is the one parser. Regenerating is mandatory
 * after a registry edit, and --check is the gate step that says so.
 *
 * It also emits which BUNDLE mounts which row (G2): the platform's Plugins page
 * keys a row's configuration page by '<bundle package name>#<row id>'
 * (ui-plugin-manager/src/client/config-ledger.ts:36), so the client half has to
 * know the pairs. The source is the bundle roster (scripts/bundle-rows.json, the
 * one source the three patches are generated from) plus each bundle package's own
 * manifest name - never a hand list.
 *
 * Usage: node gen-param-client-view.mjs <evolution-root> [--check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readRegistry } from './lib-param-registry.mjs'

/** One single-quoted TypeScript string literal (the family lint style). */
function single(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

/** English display text for the generated parameter cards. The registry keeps its Chinese UI tail as the single source; these are the language twin. */
const FIELD_LABEL_EN = {
  'evolution-approval.enabled': 'Enable approval pipeline',
  'evolution-approval.pendingTtlMs': 'Pending expiry',
  approvalConfirm: 'Confirm before approving',
  'evolution-commands.maintainHandoffOnSettle': 'Hand off after a scan',
  curatorIntervalHours: 'Tidy-up interval',
  staleAfterDays: 'Days until stale',
  archiveAfterDays: 'Archive after stale',
  minIdleHours: 'Minimum idle time',
  minIdleFailOpen: 'Run without activity signal',
  llmReview: 'Let the model nominate',
  curatorReviewMaxTokens: 'Model token budget',
  curatorReviewTimeoutMs: 'Model review timeout',
  healthSoftBodyChars: 'Body length reference',
  healthStampDensityPerKb: 'Log-like density threshold',
  healthChurnMinPatches: 'Write-only threshold',
  mergeApproval: 'Merge approval',
  mergeSkippedTtlDays: 'Keep skipped pairs',
  mergeRunTimeoutMinutes: 'Run time limit',
  reviewSkillInterval: 'Skill review interval',
  reviewMemoryInterval: 'Memory review interval',
  skillReviewTrigger: 'Skill review trigger',
  skillReviewCompletionMinToolCalls: 'Minimum tool calls on completion',
  reviewEnabled: 'Enable automatic review',
  reviewMode: 'Review location',
  reviewWakeInject: 'Notify on deferred result',
  reviewNotice: 'Result notice',
  memoryChars: 'Memory store limit',
  userChars: 'User profile limit',
  addDatePrefix: 'Prefix memory entries with date',
  maxConsolidationFailures: 'Consolidation retries',
  entryPreviewChars: 'Memory preview length',
  skillContentChars: 'Skill body limit',
  maxSkillFileBytes: 'Support file size limit',
  maxSkillNameLength: 'Skill name length limit',
  maxDescriptionLength: 'Description length limit',
  descriptionStrict: 'Reject invalid descriptions',
  strictCrossSource: 'Reject external references',
  citationPolicy: 'Citation check',
  supportFileCharPolicy: 'Oversize support file',
  skillWriteConfirm: 'Confirm before writing',
  skillWriteConfirmTimeoutSeconds: 'Confirmation timeout',
}
/** Display names for the closed group axis. */
const UNIT_EN = { '处': 'patches', '处/KB': 'per KB', '次': 'calls', '分钟': 'min', '毫秒': 'ms', '秒': 's', '天': 'days', '小时': 'hours', '字符': 'chars', '字节': 'bytes', 'token': 'tokens' }
/** Display names for the closed group axis. */
const GROUP_LABELS = {
  deployment: ['默认', 'Defaults'],
  'write-caps': ['写入上限', 'Write limits'],
  curator: ['技能整理', 'Skill tidy-up'],
  merge: ['合并', 'Merge'],
  review: ['审查', 'Review'],
  memory: ['记忆', 'Memory'],
}
/** Display names for enum values, per field. */
const VALUE_LABELS_EN = {
  approvalConfirm: ['Execute directly', 'Ask first'],
  skillReviewTrigger: ['By interval', 'On completion', 'Both'],
  reviewMode: ['In this session', 'Background branch'],
  citationPolicy: ['Verify first', 'Refuse'],
  supportFileCharPolicy: ['Warn only', 'Refuse write'],
  skillWriteConfirm: ['Write directly', 'Wait for answer', 'Cancel on timeout'],
}
/** Japanese display text for the generated parameter cards; every lookup falls back to the English twin, so an untranslated field still renders. */
const FIELD_LABEL_JA = {
  'evolution-approval.enabled': '書き込み承認を有効化',
  'evolution-approval.pendingTtlMs': '承認待ちの有効期限',
  approvalConfirm: '承認前に確認する',
  'evolution-commands.maintainHandoffOnSettle': 'スキャン完了後に自動引き継ぎ',
  curatorIntervalHours: '自動整理の間隔',
  staleAfterDays: '未使用とみなす日数',
  archiveAfterDays: '未使用になってからアーカイブまでの日数',
  minIdleHours: '最小アイドル時間',
  minIdleFailOpen: 'アクティビティを検知できなくても実行',
  llmReview: 'モデルで候補を選定する',
  curatorReviewMaxTokens: 'モデル選定の上限トークン数',
  curatorReviewTimeoutMs: 'モデル処理のタイムアウト',
  healthSoftBodyChars: '本文の長さの目安',
  healthStampDensityPerKb: '本文をログ状とみなす基準値',
  healthChurnMinPatches: '書き込みのみ判定の回数',
  mergeApproval: 'マージ承認',
  mergeSkippedTtlDays: 'マージ不要ペアの保持日数',
  mergeRunTimeoutMinutes: '1回の実行時間上限',
  reviewSkillInterval: 'スキル確認の間隔',
  reviewMemoryInterval: 'メモリ確認の間隔',
  skillReviewTrigger: 'スキル確認のタイミング',
  skillReviewCompletionMinToolCalls: '完了時の最小ツール呼び出し回数',
  reviewEnabled: '自動振り返りを有効化',
  reviewMode: '実行場所',
  reviewWakeInject: '遅延結果を通知する',
  reviewNotice: '結果の通知',
  memoryChars: 'メモリ保存の上限',
  userChars: 'ユーザープロファイルの上限',
  addDatePrefix: 'メモリ項目に日付を付ける',
  maxConsolidationFailures: '統合失敗時の再試行回数',
  entryPreviewChars: 'メモリプレビューの長さ',
  skillContentChars: 'スキル本文の上限',
  maxSkillFileBytes: '補助ファイルサイズの上限',
  maxSkillNameLength: 'スキル名の長さ上限',
  maxDescriptionLength: 'スキル説明の長さ上限',
  descriptionStrict: '基準を満たさない説明を拒否',
  strictCrossSource: '外部参照を含む場合に拒否',
  citationPolicy: '参照チェックの方法',
  supportFileCharPolicy: '補助ファイルの上限超過時',
  skillWriteConfirm: '書き込み前に確認する',
  skillWriteConfirmTimeoutSeconds: '確認の待機秒数',
}
/** Japanese help text for the generated parameter cards (falls back to the English summary). */
const FIELD_HINT_JA = {
  'evolution-approval.enabled': 'オフにすると、フォアグラウンドでの書き込みは承認を経ずに実行されます。',
  'evolution-approval.pendingTtlMs': '承認待ちの書き込みを最大どれだけ待つかです。期限を過ぎると「却下」として扱われ、実行されず内容も一切変更されません。0 は無期限で保持します（デフォルト）。',
  approvalConfirm: '「承認」を押したときに再確認するかを指定します（直接実行／先に確認）。デフォルトは直接実行で、一括承認を中断しません。',
  'evolution-commands.maintainHandoffOnSettle': 'メンテナンススキャンが正常に完了したあと、レポートを自動でモデルに引き継ぎます。デフォルトはオフで、有効にすると正常完了ごとにモデル呼び出しが1回増えます。',
  curatorIntervalHours: '自動整理を実行する最小間隔（時間）です。',
  staleAfterDays: 'スキルが連続して何日間使われなかったら未使用とみなすかを指定します。',
  archiveAfterDays: '未使用とみなされたスキルをアーカイブに移すまでの非アクティブ日数です（上の項目以上の値にしてください）。',
  minIdleHours: '自動整理を実行するまでに必要な最小のアイドル時間です。',
  minIdleFailOpen: 'アイドル状態かどうかを判定できない場合でも、自動整理を実行します。',
  llmReview: '固定のルールに加えて、モデルでも候補を選定します。',
  curatorReviewMaxTokens: 'モデルで候補を選定する1回あたりの最大トークン数（モデルの課金単位）です。',
  curatorReviewTimeoutMs: 'モデルによる候補選定の最大実行時間です。',
  healthSoftBodyChars: 'スキルの本文が長すぎると判定する文字数の目安です（健全性の表示にのみ使われます）。',
  healthStampDensityPerKb: '1 KB あたりにタイムスタンプが何個以上含まれたら「ログ状」と判定するかを指定します。',
  healthChurnMinPatches: '読み取られないまま何回連続で変更されたら「書き込みのみで未参照」と判定するかを指定します。',
  mergeApproval: 'オンにすると、第1段階の判定後に一時停止して承認待ちに入ります。オフにするとそのまま第2段階のマージに進みます。',
  mergeSkippedTtlDays: 'マージ不要と判定されたペアを選別対象から外しておく日数です。0 にすると無期限で保持します。',
  mergeRunTimeoutMinutes: '1回のマージ実行の最大時間（分）です。0 にすると上限を設けません。',
  reviewSkillInterval: 'ツール呼び出しが累計何回に達したらスキルを確認するかを指定します。1ターンはそのターンのツール呼び出し回数分（呼び出しがないターンも1回分）加算され、そのターン自体でスキルを使った場合は1回分のみ加算されます。',
  reviewMemoryInterval: 'ツール呼び出しが累計何回に達したらメモリを確認するかを指定します。1ターンはそのターンのツール呼び出し回数分（呼び出しがないターンも1回分）加算され、そのターン自体でメモリを使った場合は1回分のみ加算されます。',
  skillReviewTrigger: 'スキルを確認するタイミングを指定します（間隔ごと／タスク完了時／両方）。',
  skillReviewCompletionMinToolCalls: '「タスク完了時」を選んだ場合に、確認を行うために必要な最小ツール呼び出し回数です。',
  reviewEnabled: 'オフにすると、セッションの自動振り返りを行いません。',
  reviewMode: '振り返りをどこで実行するかを指定します（現在のセッション内／バックグラウンドブランチ）。',
  reviewWakeInject: 'セッションのアイドル時に、遅延していた確認結果を通知メッセージとして送ります。',
  reviewNotice: 'オフにすると確認結果を会話に書き込みません。確認自体は通常どおり実行され、結果は監査記録に残ります。',
  memoryChars: '長期メモリファイル（MEMORY.md）の最大文字数です。',
  userChars: 'ユーザープロファイルファイル（USER.md）の最大文字数です。',
  addDatePrefix: '書き込み時に項目の先頭へ日付を付けます。',
  maxConsolidationFailures: 'メモリの統合が連続して何回失敗したら停止するかを指定します。',
  entryPreviewChars: '一覧で各メモリ項目を表示する最大文字数です。',
  skillContentChars: 'スキル Markdown（SKILL.md）本文の最大文字数です（小さくする変更のみ可能で、初期上限は超えられません）。',
  maxSkillFileBytes: 'スキルの補助ファイル1つあたりの最大バイト数です（小さくする変更のみ可能で、初期上限は超えられません）。',
  maxSkillNameLength: 'スキル名の最大文字数です（小さくする変更のみ可能）。',
  maxDescriptionLength: 'スキル説明の最大文字数です（小さくする変更のみ可能）。',
  descriptionStrict: '説明が基準を満たさない場合に書き込みを拒否します（デフォルトは通知のみ）。',
  strictCrossSource: 'スキルがこのプラグイン外のファイルを参照している場合に書き込みを拒否します。',
  citationPolicy: 'スキルの移動やマージ時に参照切れをどう扱うかを指定します（先に検証／拒否）。',
  supportFileCharPolicy: '補助ファイルが上限を超えたときの扱いを指定します（通知のみ／書き込みを拒否）。',
  skillWriteConfirm: 'スキルの新規作成や削除の前に確認するかを指定します（直接書き込む／回答を待つ／タイムアウト時にキャンセル）。',
  skillWriteConfirmTimeoutSeconds: '「タイムアウト時にキャンセル」を選んだ場合に、回答を待ってから書き込みをキャンセルするまでの秒数です。',
}
/** Japanese unit suffixes (falls back to English). */
const UNIT_JA = { '处': '件', '处/KB': '件/KB', '次': '回', '分钟': '分', '毫秒': 'ミリ秒', '秒': '秒', '天': '日', '小时': '時間', '字符': '文字', '字节': 'バイト', 'token': 'トークン' }
/** Japanese group headings (falls back to English). */
const GROUP_LABELS_JA = {
  deployment: 'デフォルト',
  'write-caps': '書き込み上限',
  curator: 'スキル整理',
  merge: 'マージ',
  review: '振り返り',
  memory: 'メモリ',
}
/** Japanese enum display names (falls back to English). */
const VALUE_LABELS_JA = {
  approvalConfirm: ['直接実行', '先に確認'],
  skillReviewTrigger: ['間隔ごと', 'タスク完了時', '両方'],
  reviewMode: ['現在のセッション内', 'バックグラウンドブランチ'],
  citationPolicy: ['先に検証', '拒否'],
  supportFileCharPolicy: ['通知のみ', '書き込みを拒否'],
  skillWriteConfirm: ['直接書き込む', '回答を待つ', 'タイムアウト時にキャンセル'],
}
const argv = process.argv.slice(2)
const rootArg = argv.find(arg => !arg.startsWith('--'))
const root = resolve(rootArg ?? 'packages')
const check = argv.includes('--check')
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--check')
if (unknown.length > 0) {
  console.error('gen-param-client-view: unknown flag ' + unknown.join(', ') + ' — usage: node gen-param-client-view.mjs <evolution-root> [--check]')
  process.exit(2)
}

const registry = readRegistry(root)
/**
 * One card per ROW ID; fields keep registry order. Only E3 rows have a user layer.
 *
 * The card key is the row's entry id, not the legacy namespace string: the platform
 * keys a settings section by the Loader entry id (`settings.describe()` reports
 * `ns: entry.options.id`), and `configForms.get(entryId)` looks it up. The owner field
 * IS that row id; the legacy string in PARAM_NAMESPACES is the G3 migration source.
 */
const sections = new Map()
for (const entry of registry.entries) {
  // The card key is the row's OWN exposure declaration (0.21.0 / G2): `card` names the settings row
  // that renders this field, and `registryViolations` guarantees every E3 row carries one (equal to
  // its own id) while no other tier does. Reading `owner` here was the same fact one indirection
  // earlier — and it silently rendered a card for a row whose owner never registered a namespace.
  const namespace = entry.card
  if (namespace === undefined) continue
  const fields = sections.get(namespace) ?? []
  // The UI metadata travels with the field: the card's label/help text, the control
  // kind, the unit suffix and the value domain all come from the registry text.
  fields.push({
    id: entry.id,
    group: entry.group,
    doc: entry.summary,
    label: entry.label ?? '',
    labelEn: FIELD_LABEL_EN[entry.id] ?? entry.label ?? entry.id,
    labelJa: FIELD_LABEL_JA[entry.id] ?? FIELD_LABEL_EN[entry.id] ?? entry.label ?? entry.id,
    hint: entry.hint ?? '',
    hintEn: entry.summary,
    hintJa: FIELD_HINT_JA[entry.id] ?? entry.summary,
    groupLabel: GROUP_LABELS[entry.group]?.[0] ?? entry.group,
    groupLabelEn: GROUP_LABELS[entry.group]?.[1] ?? entry.group,
    groupLabelJa: GROUP_LABELS_JA[entry.group] ?? GROUP_LABELS[entry.group]?.[1] ?? entry.group,
    control: entry.control ?? 'text',
    unit: entry.unit ?? '',
    unitEn: UNIT_EN[entry.unit ?? ''] ?? entry.unit ?? '',
    unitJa: UNIT_JA[entry.unit ?? ''] ?? UNIT_EN[entry.unit ?? ''] ?? entry.unit ?? '',
    values: (entry.values ?? '').split('|').filter(Boolean),
    // Display names for `values`, same order; an empty list keeps the raw value as the
    // option text (older registries have no valueLabels at all).
    valueLabels: (entry.valueLabels ?? '').split('|').filter(Boolean),
    valueLabelsEn: VALUE_LABELS_EN[entry.id] ?? (entry.valueLabels ?? '').split('|').filter(Boolean),
    valueLabelsJa: VALUE_LABELS_JA[entry.id] ?? VALUE_LABELS_EN[entry.id] ?? (entry.valueLabels ?? '').split('|').filter(Boolean),
    // U-4: the cross-field constraint travels with the field, so the CARD can refuse a violating
    // pair before a save is attempted. It is declared once in the registry (params.ts) and the Host
    // write path derives the same check from that same column.
    atLeast: entry.relation?.atLeast ?? '',
  })
  sections.set(namespace, fields)
}
const ordered = [...sections.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)

/**
 * Which bundle mounts which generated namespace (G2). The roster may be absent (a
 * fixture root) - that yields no seat rather than a failure, and --check still
 * compares whatever this run derives.
 * @returns one entry per bundle that mounts at least one generated namespace.
 */
function rowSeats() {
  const rosterPath = join(root, 'scripts', 'bundle-rows.json')
  if (!existsSync(rosterPath)) return []
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8'))
  const mounted = new Set(ordered.map(([namespace]) => namespace))
  const seats = []
  for (const form of Object.keys(roster.forms ?? {}).sort()) {
    const manifestPath = join(root, 'evolution-' + form, 'package.json')
    if (!existsSync(manifestPath)) continue
    const bundle = JSON.parse(readFileSync(manifestPath, 'utf8')).name
    const rows = (roster.rows ?? [])
      .filter(row => (row.forms ?? []).includes(form) && mounted.has(row.id))
      .map(row => row.id)
      .sort()
    if (rows.length > 0) seats.push({ bundle, rows })
  }
  return seats.sort((a, b) => a.bundle < b.bundle ? -1 : 1)
}
const seats = rowSeats()
// A card whose row no bundle mounts can never render: fail loud instead of shipping a dead
// namespace into the browser half. A fixture root without the roster keeps its "no seat" state
// (rowSeats() already returns [] there, and that degradation is the fixture's own concern).
if (existsSync(join(root, 'scripts', 'bundle-rows.json'))) {
  const seated = new Set(seats.flatMap(seat => seat.rows))
  const unseated = [...sections.keys()].filter(namespace => !seated.has(namespace))
  if (unseated.length > 0) {
    console.error('gen-param-client-view: ' + unseated.join(', ') + ' has cards but no bundle mounts that row — a card for an unmounted row can never render (roster: scripts/bundle-rows.json) — add the row to the bundle patches or move it to `why`')
    process.exit(1)
  }
}
const lines = [
  "/**",
  " * GENERATED by packages/scripts/gen-param-client-view.mjs — do not edit.",
  " *",
  " * One card per settings namespace; fields are the E3 rows of the registry, so",
  " * the browser half names exactly what the Host half registers.",
  " */",
  "",
  "/** One field a card renders a control for. */",
  "export interface ClientParamField {",
  "  id: string",
  "  group: string",
  "  /** User-language group heading. */",
  "  groupLabel: string",
  "  /** English group heading. */",
  "  groupLabelEn: string",
  "  /** Japanese group heading (optional: falls back to English). */",
  "  groupLabelJa?: string",
  "  /** U-4: the sibling id this field may not go below (an empty string when the row declares no relation). */",
  "  atLeast: string",
  "  /** The registry summary (English), kept for parity with PARAMETERS.md. */",
  "  doc: string",
  "  /** Card label, from the registry UI tail (Chinese). */",
  "  label: string",
  "  /** English card label (the registry UI tail is Chinese). */",
  "  labelEn: string",
  "  /** Japanese card label (optional: falls back to English). */",
  "  labelJa?: string",
  "  /** Card help text, from the registry UI tail (Chinese). */",
  "  hint: string",
  "  /** English help text. */",
  "  hintEn: string",
  "  /** Japanese help text (optional: falls back to English). */",
  "  hintJa?: string",
  "  /** Which control the card renders. */",
  "  control: 'number' | 'switch' | 'select' | 'text'",
  "  /** Unit suffix for a number field ('' when it carries none). */",
  "  unit: string",
  "  /** English unit suffix. */",
  "  unitEn: string",
  "  /** Japanese unit suffix (optional: falls back to English). */",
  "  unitJa?: string",
  "  /** Allowed values for a select field ([] otherwise). */",
  "  values: readonly string[]",
  "  /** Display names for `values`, same order ([] shows the raw value). */",
  "  valueLabels: readonly string[]",
  "  /** English display names for `values`, same order. */",
  "  valueLabelsEn: readonly string[]",
  "  /** Japanese display names for `values`, same order (optional: falls back to English). */",
  "  valueLabelsJa?: readonly string[]",
  "}",
  "",
  "/** One card: the settings namespace it writes through, the SEAT key its source is looked up by,",
  " * and the fields it exposes. A73 (`ClientParamSection.namespace` 一名字两义): the two roles are",
  " * spelled separately so a Host may key them differently — `namespace` is what a save writes into",
  " * (`update(namespace, patch)`) and what the card title is looked up by; `seatKey` is what the",
  " * shell's `sources.sourceFor(...)` probes. Both are the LOADER ROW ID today. */",
  "export interface ClientParamSection {",
  "  namespace: string",
  "  /** The settings-card seat key the shell probes for this section's source. */",
  "  seatKey: string",
  "  fields: readonly ClientParamField[]",
  "}",
  "",
  "export const CLIENT_PARAM_SECTIONS: readonly ClientParamSection[] = [",
]
for (const [namespace, fields] of ordered) {
  lines.push('  {')
  lines.push('    namespace: ' + single(namespace) + ',')
  // A73: the seat key is emitted as its own field, from the same registry value today.
  lines.push('    seatKey: ' + single(namespace) + ',')
  lines.push('    fields: [')
  for (const field of fields) {
    const values = '[' + field.values.map(single).join(', ') + ']'
    const valueLabels = '[' + field.valueLabels.map(single).join(', ') + ']'
    lines.push('      { id: ' + single(field.id) + ', group: ' + single(field.group) + ', groupLabel: ' + single(field.groupLabel) + ', groupLabelEn: ' + single(field.groupLabelEn) + ', groupLabelJa: ' + single(field.groupLabelJa) + ', doc: ' + single(field.doc) +
      ', label: ' + single(field.label) + ', labelEn: ' + single(field.labelEn) + ', labelJa: ' + single(field.labelJa) + ', hint: ' + single(field.hint) + ', hintEn: ' + single(field.hintEn) + ', hintJa: ' + single(field.hintJa) + ', control: ' + single(field.control) +
      ', unit: ' + single(field.unit) + ', unitEn: ' + single(field.unitEn) + ', unitJa: ' + single(field.unitJa) + ', values: ' + values + ', valueLabels: ' + valueLabels + ', valueLabelsEn: ' + '[' + (field.valueLabelsEn ?? []).map(single).join(', ') + ']' + ', valueLabelsJa: ' + '[' + (field.valueLabelsJa ?? []).map(single).join(', ') + ']' +
      // U-4: the cross-field column is rendered explicitly, like every other key here — a field object
      // that carries it and a renderer that drops it would be the same silent loss the card exists for.
      ', atLeast: ' + single(field.atLeast ?? '') + ' },')
  }
  lines.push('    ],')
  lines.push('  },')
}
lines.push(']', '')
lines.push('')
const target = join(root, 'evolution-ui', 'src', 'panels', 'settings', 'generated-params.ts')
const document = lines.join('\n')
const previous = existsSync(target) ? readFileSync(target, 'utf8') : null
const fieldCount = ordered.reduce((total, [, fields]) => total + fields.length, 0)
const summary = ordered.length + ' namespace(s), ' + fieldCount + ' field(s)'
if (previous === document) {
  console.log('gen-param-client-view: up to date — ' + summary)
  process.exit(0)
}
if (check) {
  console.error('gen-param-client-view: STALE — ' + target + ' differs from the registry (' + summary + '); rerun without --check')
  process.exit(1)
}
writeFileSync(target, document, 'utf8')
console.log('gen-param-client-view: wrote ' + target + ' (' + summary + ')')
