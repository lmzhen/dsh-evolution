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
  reviewMode: ['Plugin auxiliary', 'In this session (debug)'],
  citationPolicy: ['Verify first', 'Refuse'],
  supportFileCharPolicy: ['Warn only', 'Refuse write'],
  skillWriteConfirm: ['Write directly', 'Wait for answer', 'Cancel on timeout'],
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
    hint: entry.hint ?? '',
    hintEn: entry.summary,
    groupLabel: GROUP_LABELS[entry.group]?.[0] ?? entry.group,
    groupLabelEn: GROUP_LABELS[entry.group]?.[1] ?? entry.group,
    control: entry.control ?? 'text',
    unit: entry.unit ?? '',
    unitEn: UNIT_EN[entry.unit ?? ''] ?? entry.unit ?? '',
    values: (entry.values ?? '').split('|').filter(Boolean),
    // Display names for `values`, same order; an empty list keeps the raw value as the
    // option text (older registries have no valueLabels at all).
    valueLabels: (entry.valueLabels ?? '').split('|').filter(Boolean),
    valueLabelsEn: VALUE_LABELS_EN[entry.id] ?? (entry.valueLabels ?? '').split('|').filter(Boolean),
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
  "  /** U-4: the sibling id this field may not go below (an empty string when the row declares no relation). */",
  "  atLeast: string",
  "  /** The registry summary (English), kept for parity with PARAMETERS.md. */",
  "  doc: string",
  "  /** Card label, from the registry UI tail (Chinese). */",
  "  label: string",
  "  /** English card label (the registry UI tail is Chinese). */",
  "  labelEn: string",
  "  /** Card help text, from the registry UI tail (Chinese). */",
  "  hint: string",
  "  /** English help text. */",
  "  hintEn: string",
  "  /** Which control the card renders. */",
  "  control: 'number' | 'switch' | 'select' | 'text'",
  "  /** Unit suffix for a number field ('' when it carries none). */",
  "  unit: string",
  "  /** English unit suffix. */",
  "  unitEn: string",
  "  /** Allowed values for a select field ([] otherwise). */",
  "  values: readonly string[]",
  "  /** Display names for `values`, same order ([] shows the raw value). */",
  "  valueLabels: readonly string[]",
  "  /** English display names for `values`, same order. */",
  "  valueLabelsEn: readonly string[]",
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
    lines.push('      { id: ' + single(field.id) + ', group: ' + single(field.group) + ', groupLabel: ' + single(field.groupLabel) + ', groupLabelEn: ' + single(field.groupLabelEn) + ', doc: ' + single(field.doc) +
      ', label: ' + single(field.label) + ', labelEn: ' + single(field.labelEn) + ', hint: ' + single(field.hint) + ', hintEn: ' + single(field.hintEn) + ', control: ' + single(field.control) +
      ', unit: ' + single(field.unit) + ', unitEn: ' + single(field.unitEn) + ', values: ' + values + ', valueLabels: ' + valueLabels + ', valueLabelsEn: ' + '[' + (field.valueLabelsEn ?? []).map(single).join(', ') + ']' +
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
