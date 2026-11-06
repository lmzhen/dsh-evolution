/**
 * G6/W8: `buildDoctorView` — the ONE producer of DiagnosticsView.
 *
 * CLI `--json`, the diagnostics route (W6) and the client diagnostics card (W7) all call this
 * function, so they cannot drift: 7 facts (declared/derived values, homes named) + 8 runtime rows
 * (measured state, never rendered as ok when unreadable). The function is pure and NEVER throws: a
 * missing/undecidable provider becomes an `unknown`/`warn`/`fail` row with a remedy, because a
 * doctor that fails to answer is worse than one that names its blind spots.
 * @module @deepseek-ai/dsh-evolution-commands/doctor-view
 */
import type { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DIAGNOSTICS_FACT_KEYS,
  DIAGNOSTICS_RUNTIME_KEYS,
  DIAGNOSTICS_VIEW_SCHEMA_VERSION,
  EVOLUTION_PRESET_IDS,
  MAINTAINER_PRESET_ID,
  PLATFORM_LINE,
  REVIEWER_PRESET_ID,
  classifySessionEvent,
  createSubagentChannel,
  errorText,
  hostSurface,
  type ChannelState,
  type DiagnosticRow,
  type DiagnosticsView,
  type DocFactRow,
} from '@deepseek-ai/dsh-evolution-core'
import { COMMAND_FALLBACKS } from './command-fallback.ts'

/** The install form the running profile was classified as (W8 §2 runtime install-form-detected). */
export type InstallFormId = 'M1' | 'M2' | 'M3' | 'M4'

/** One preset's probe result (reviewer/maintainer). */
export interface PresetFacts {
  readonly registered: boolean
  readonly broken?: string | undefined
  readonly id?: string | undefined
}

/** The platform/connection pairing verdict. */
export type PlatformPairing = 'in-window' | 'host-newer' | 'out-of-window' | 'unknown'

/**
 * Every input the view reads. Callers assemble it (assembleDoctorInputs does the soft probing);
 * tests drive each branch directly.
 */
export interface DoctorInputs {
  readonly now: Date
  readonly platformLine: { readonly version: string; readonly floor: string }
  readonly familyVersion: string
  readonly hostVersion?: string | undefined
  readonly form: { readonly id: InstallFormId; readonly evidence: readonly string[]; readonly confidence: 'declared' | 'inferred' }
  readonly probes: { readonly agentPresets: boolean; readonly connection: boolean }
  readonly channels: { readonly review: ChannelState; readonly maintenance: ChannelState }
  readonly presets: { readonly reviewer?: PresetFacts | undefined; readonly maintainer?: PresetFacts | undefined }
  readonly host: { readonly mounted: boolean; readonly reason?: string | undefined; readonly deploymentAllowsRemote?: boolean | undefined }
  readonly runs: { readonly running: number; readonly orphaned: number }
  readonly missingServices?: readonly string[] | undefined
  readonly sessionFoldClassifierPresent?: boolean | undefined
  readonly platformPairing?: PlatformPairing | undefined
  /** Human-facing total of registered host routes, when the carrier reports one (12 today). */
  readonly hostRouteCount?: { readonly mounted: number; readonly total: number } | undefined
}

const FACT_HOMES: Readonly<Record<string, string>> = {
  'platform-line': 'README.md（兼容线声明）',
  'family-version': 'README.md（家族版本）',
  'install-form': 'packages/INSTALL.md（安装形态与验证状态）',
  'preset-ids': 'evolution-core/README.md（preset id 冻结表）',
  'readonly-contract': 'evolution-review/README.md（只读契约）',
  'upgrade-order': 'packages/INSTALL.md（升级 runbook）',
  'fallback-map': 'packages/INSTALL.md（命令兜底表）',
}

const FACT_LABELS: Readonly<Record<string, string>> = {
  'platform-line': '兼容版本',
  'family-version': '家族版本',
  'install-form': '安装方式',
  'preset-ids': '只读模式',
  'readonly-contract': '只读说明',
  'upgrade-order': '升级顺序',
  'fallback-map': '命令备用',
}

const RUNTIME_LABELS: Readonly<Record<string, string>> = {
  'subagent-channel': '审阅/维护代理',
  'restricted-preset': '只读模式',
  'host-surface': '数据连接',
  'session-fold': '会话事件读取',
  'platform-services': '平台服务',
  runs: '运行记录',
  'platform-pairing': '版本兼容',
  'install-form-detected': '安装方式',
}

/**
 * The install form in reader-facing words. The M1..M4 ids stay internal (the runtime rows and
 * --json keep them); a settings reader sees what the deployment is FOR, not the code name.
 */
const FORM_WORDS: Readonly<Record<InstallFormId, string>> = Object.freeze({
  M1: '完整功能包',
  M2: '人工审批包',
  M3: '会话预设包',
  M4: '分层安装',
})

/**
 * Build the seven documentation facts. Values are READER-FACING prose: the CLI text, --json and
 * the settings card all print the same strings, so internal codes, raw evidence paths and
 * "declared/inferred" jargon stay out of the value (the runtime rows and the per-fact home carry
 * the technical half).
 * @param inputs - assembled doctor inputs.
 * @returns the ordered fact rows.
 */
function factsOf(inputs: DoctorInputs): DocFactRow[] {
  const values: Record<string, string> = {
    'platform-line': inputs.platformLine.version + '（最低兼容 ' + inputs.platformLine.floor + '）',
    'family-version': inputs.familyVersion,
    'install-form': FORM_WORDS[inputs.form.id] + '（' + (inputs.form.confidence === 'declared' ? '安装内容已确认' : '按已安装内容推断') + '）',
    'preset-ids': '审阅、维护各有一个只读模式（' + REVIEWER_PRESET_ID + ' / ' + MAINTAINER_PRESET_ID + '）；另有 ' + String(EVOLUTION_PRESET_IDS.length) + ' 个基础预设可选',
    'readonly-contract': '只读模式下能做什么，由该模式声明的工具清单决定（审阅和维护一样）',
    'upgrade-order': '先升平台，再升家族，最后发布（详见 INSTALL 的升级说明）',
    'fallback-map': String(Object.keys(COMMAND_FALLBACKS).length) + ' 个功能页都有命令备用（见 INSTALL 的命令备用表）。',
  }
  const rows: DocFactRow[] = DIAGNOSTICS_FACT_KEYS.map(key => ({
    key,
    label: FACT_LABELS[key] ?? key,
    value: values[key] ?? 'unknown',
    home: FACT_HOMES[key] ?? 'README.md',
  }))
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

function channelRow(channels: DoctorInputs['channels']): DiagnosticRow {
  const unavailable = [channels.review, channels.maintenance].filter(
    (state): state is Extract<ChannelState, { kind: 'unavailable' }> => state.kind === 'unavailable',
  )
  if (unavailable.length === 0) {
    return { key: 'subagent-channel', label: RUNTIME_LABELS['subagent-channel'] ?? '审阅/维护代理', status: 'ok', detail: '审阅和维护代理都可用。' }
  }
  const reasons = unavailable.map(state => state.code + ': ' + state.reason)
  return {
    key: 'subagent-channel',
    label: RUNTIME_LABELS['subagent-channel'] ?? '审阅/维护代理',
    status: 'warn',
    detail: reasons.join('；'),
    remedy: '审阅和维护会明确标为不可用（不会静默改在当前会话里跑）；运行 /evolution doctor 查看修复指引。',
  }
}

function presetRow(presets: DoctorInputs['presets']): DiagnosticRow {
  const entries = [presets.reviewer, presets.maintainer]
  if (entries.every(entry => entry === undefined)) {
    return { key: 'restricted-preset', label: RUNTIME_LABELS['restricted-preset'] ?? '只读模式', status: 'unknown', detail: '平台没有提供预设列表，暂时无法检查只读模式。', remedy: '这是平台安装不完整；重新安装或重启程序后再检查。' }
  }
  const broken = entries.filter((entry): entry is PresetFacts => entry !== undefined && entry.broken !== undefined)
  const missing = entries.filter(entry => entry === undefined || !entry.registered)
  if (broken.length > 0) {
    return { key: 'restricted-preset', label: RUNTIME_LABELS['restricted-preset'] ?? '只读模式', status: 'fail', detail: errorText('e-324-restricted-preset-unavailable', { a1: broken.map(entry => entry.broken ?? '').join('；') }), remedy: '重新加载家族插件；若仍失败，运行 /evolution doctor 查看详情。' }
  }
  if (missing.length > 0) {
    return { key: 'restricted-preset', label: RUNTIME_LABELS['restricted-preset'] ?? '只读模式', status: 'warn', detail: '只读的审阅/维护模式还没启用（第一次运行审阅或维护时会自动创建）。', remedy: '运行一次审阅或维护，或稍后重新检查。' }
  }
  return { key: 'restricted-preset', label: RUNTIME_LABELS['restricted-preset'] ?? '只读模式', status: 'ok', detail: '审阅和维护的只读模式都已就绪' }
}

function hostRow(host: DoctorInputs['host'], count: DoctorInputs['hostRouteCount']): DiagnosticRow {
  if (!host.mounted) {
    const fallback = COMMAND_FALLBACKS.approval.command.split(' … ')[0] ?? ''
    return {
      key: 'host-surface',
      label: RUNTIME_LABELS['host-surface'] ?? '数据连接',
      status: 'warn',
      detail: errorText('e-325-host-data-plane-unavailable') + '（' + (host.reason ?? 'unknown') + '）',
      remedy: '改用命令完成同样的操作：' + fallback + ' 等；运行 /evolution doctor 查看服务状态。',
    }
  }
  const remote = host.deploymentAllowsRemote === true ? '允许远程访问（按平台设置）' : '仅限本机访问（按平台设置）'
  const mounted = count === undefined ? '已就绪' : '已就绪 ' + String(count.mounted) + '/' + String(count.total)
  return { key: 'host-surface', label: RUNTIME_LABELS['host-surface'] ?? '数据连接', status: 'ok', detail: mounted + '；' + remote }
}

function pairingRow(inputs: DoctorInputs): DiagnosticRow {
  const status = inputs.platformPairing ?? 'unknown'
  switch (status) {
    case 'in-window':
      return { key: 'platform-pairing', label: RUNTIME_LABELS['platform-pairing'] ?? '版本兼容', status: 'ok', detail: '程序版本 ' + String(inputs.hostVersion) + ' 在兼容范围内（' + inputs.platformLine.version + '）' }
    case 'host-newer':
      return { key: 'platform-pairing', label: RUNTIME_LABELS['platform-pairing'] ?? '版本兼容', status: 'warn', detail: '程序已经更新（' + String(inputs.hostVersion) + '，本插件声明 ' + inputs.platformLine.version + '）。', remedy: '先升级程序，再升级本插件。' }
    case 'out-of-window':
      return { key: 'platform-pairing', label: RUNTIME_LABELS['platform-pairing'] ?? '版本兼容', status: 'fail', detail: '程序版本 ' + String(inputs.hostVersion) + ' 低于最低兼容版本（' + inputs.platformLine.floor + '）。', remedy: '先把程序升/降到兼容版本，再重启本插件。' }
    case 'unknown':
      return { key: 'platform-pairing', label: RUNTIME_LABELS['platform-pairing'] ?? '版本兼容', status: 'unknown', detail: inputs.hostVersion === undefined ? '读不到程序版本。' : '无法判断版本是否兼容。', remedy: '在会话里运行 /evolution doctor。' }
  }
}

function runtimeOf(inputs: DoctorInputs): DiagnosticRow[] {
  const missing = inputs.missingServices ?? []
  const fold = inputs.sessionFoldClassifierPresent !== false
  const rows: DiagnosticRow[] = [
    channelRow(inputs.channels),
    presetRow(inputs.presets),
    hostRow(inputs.host, inputs.hostRouteCount),
    fold
      ? { key: 'session-fold', label: RUNTIME_LABELS['session-fold'] ?? '会话事件读取', status: 'ok', detail: '事件读取通道正常：对话内容会被读取，其余记录忽略。' }
      : { key: 'session-fold', label: RUNTIME_LABELS['session-fold'] ?? '会话事件读取', status: 'fail', detail: '事件读取组件缺失，无法确认读取通道正常。', remedy: '重新安装完整功能包（evolution-all）。' },
    missing.length === 0
      ? { key: 'platform-services', label: RUNTIME_LABELS['platform-services'] ?? '平台服务', status: 'ok', detail: '需要的服务都已就绪' }
      : { key: 'platform-services', label: RUNTIME_LABELS['platform-services'] ?? '平台服务', status: 'warn', detail: '缺少：' + missing.join('、'), remedy: '安装 evolution-host 或 evolution-all，或检查配置。' },
    inputs.runs.orphaned > 0
      ? { key: 'runs', label: RUNTIME_LABELS.runs ?? '运行登记', status: 'warn', detail: '正在运行 ' + String(inputs.runs.running) + ' 个，遗留 ' + String(inputs.runs.orphaned) + ' 个', remedy: '运行 /evolution maintain status 查看并处理遗留运行。' }
      : { key: 'runs', label: RUNTIME_LABELS.runs ?? '运行登记', status: 'ok', detail: '正在运行 ' + String(inputs.runs.running) + ' 个，没有遗留' },
    pairingRow(inputs),
    inputs.form.confidence === 'declared'
      ? { key: 'install-form-detected', label: RUNTIME_LABELS['install-form-detected'] ?? '实际安装形态', status: 'ok', detail: FORM_WORDS[inputs.form.id] + '（已确认）' }
      : { key: 'install-form-detected', label: RUNTIME_LABELS['install-form-detected'] ?? '实际安装形态', status: 'warn', detail: FORM_WORDS[inputs.form.id] + '（按已安装内容推断：' + inputs.form.evidence.join('、') + '）', remedy: '在配置里明确写出安装方式，并核对 INSTALL 的安装方式表。' },
  ]
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Build the frozen DiagnosticsView. Pure; never throws.
 * @param inputs - everything the 7+8 rows read (assembleDoctorInputs probes the live host).
 */
export function buildDoctorView(inputs: DoctorInputs): DiagnosticsView {
  return {
    schemaVersion: DIAGNOSTICS_VIEW_SCHEMA_VERSION,
    generatedAt: inputs.now.toISOString(),
    facts: factsOf(inputs),
    runtime: runtimeOf(inputs),
  }
}

/** A safe view for a host whose inputs could not be assembled: every row names the failure. */
export function unavailableDoctorView(now: Date, reason: string): DiagnosticsView {
  const facts: DocFactRow[] = DIAGNOSTICS_FACT_KEYS.map(key => ({ key, label: FACT_LABELS[key] ?? key, value: 'unknown', home: FACT_HOMES[key] ?? 'README.md' }))
  const runtime: DiagnosticRow[] = DIAGNOSTICS_RUNTIME_KEYS.map(key => ({ key, label: RUNTIME_LABELS[key] ?? key, status: 'unknown', detail: '读不到诊断所需的信息：' + reason, remedy: '运行 /evolution doctor 重试；若持续失败，检查宿主日志。' }))
  return {
    schemaVersion: DIAGNOSTICS_VIEW_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    facts: facts.sort((a, b) => a.key.localeCompare(b.key)),
    runtime: runtime.sort((a, b) => a.key.localeCompare(b.key)),
  }
}

/** The family version this build carries (nearest package.json above the running module). */
export function familyVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url))
    for (let hops = 0; hops < 32; hops += 1) {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }
        if (typeof parsed.version === 'string') return parsed.version
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* version unknown is an honest 'unknown', not a throw */ }
  return 'unknown'
}

/** The soft service probe list for the platform-services row. */
const SERVICES_PROBED: readonly string[] = ['connection', 'agentPresets', 'subagents', 'commands', 'settings']

/** The host's own version, read from the installed platform manifest (soft: absent = unknown). */
function hostRuntimeVersion(): string | undefined {
  for (const packageName of ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh']) {
    try {
      const require = createRequire(import.meta.url)
      const manifest = require.resolve(packageName + '/package.json')
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }
      if (typeof parsed.version === 'string' && parsed.version !== '') return parsed.version
    } catch { /* try the next manifest */ }
  }
  return undefined
}

/** The family bundles the platform reports (soft probe: a host without the manager answers []). */
async function installedFamilyBundles(ctx: Context): Promise<readonly string[]> {
  const manager = (ctx as unknown as { get(service: string): unknown }).get('pluginManager')
  const listed = await (manager as { listBundles?(): unknown } | undefined)?.listBundles?.()
  if (!Array.isArray(listed)) return []
  const names: string[] = []
  for (const entry of listed) {
    if (typeof entry !== 'object' || entry === null) continue
    const name = (entry as { name?: unknown }).name
    if (typeof name === 'string' && name.includes('dsh-evolution-')) names.push(name)
  }
  return names
}

/**
 * Assemble the view inputs through the live Context's soft probes.
 *
 * Every probe is optional: an absent service becomes a row value (unknown/warn), never a throw. The
 * channel probe uses W5's own `createSubagentChannel` state machinery, so the doctor reports the
 * SAME availability the review/maintenance runs would see.
 * @param ctx - the host context.
 * @param extras - call-site facts the context cannot answer (runs, host version, install form).
 */
export async function assembleDoctorInputs(ctx: Context, extras: {
  readonly runs?: { readonly running: number; readonly orphaned: number } | undefined
  readonly hostVersion?: string | undefined
  readonly form?: DoctorInputs['form'] | undefined
  readonly platformPairing?: PlatformPairing | undefined
  readonly now?: Date | undefined
} = {}): Promise<DoctorInputs> {
  const get = (name: string): unknown => (ctx as unknown as { get(service: string): unknown }).get(name)
  const channel = createSubagentChannel(ctx)
  const probeChannel = async (kind: 'reviewer' | 'maintainer'): Promise<ChannelState> => {
    try { return await channel.prepare({ kind, allow: ['skill'] }) } catch (error) {
      return { kind: 'unavailable', code: 'E-323', reason: error instanceof Error ? error.message : String(error) }
    }
  }
  const [review, maintenance] = await Promise.all([probeChannel('reviewer'), probeChannel('maintainer')])
  const presetsService = get('agentPresets') as { list?(): unknown } | undefined
  let listed: readonly { id?: unknown; broken?: unknown }[] = []
  try {
    const value = await presetsService?.list?.()
    if (Array.isArray(value)) listed = value as readonly { id?: unknown; broken?: unknown }[]
  } catch { listed = [] }
  const presetOf = (id: string): PresetFacts | undefined => {
    if (listed.length === 0) return undefined
    const entry = listed.find(candidate => candidate.id === id)
    if (entry === undefined) return { id, registered: false }
    return { id, registered: true, ...(typeof entry.broken === 'string' ? { broken: entry.broken } : {}) }
  }
  const bundles = await installedFamilyBundles(ctx)
  const hasAll = bundles.some(name => name.endsWith('dsh-evolution-all'))
  const hasPreset = bundles.some(name => name.endsWith('dsh-evolution-preset'))
  const hasHost = bundles.some(name => name.endsWith('dsh-evolution-host'))
  // M4 (host + generated family preset): the preset row is installed into the profile patch and the
  // registry reports the family preset id; a host-only face (M3) does not.
  const hasFamilyPreset = listed.some(entry => typeof entry.id === 'string' && EVOLUTION_PRESET_IDS.includes(entry.id as never))
  const approval = get('evolutionApproval') as { readonly isEnabled?: boolean } | undefined
  const humanGated = approval?.isEnabled === true
  const detectedForm: DoctorInputs['form'] = hasAll || hasPreset
    ? { id: humanGated ? 'M2' : 'M1', evidence: [hasAll ? 'bundle dsh-evolution-all installed' : 'bundle dsh-evolution-preset installed', ...(humanGated ? ['approval.enabled: true'] : [])], confidence: 'declared' }
    : hasHost
      ? hasFamilyPreset
        ? { id: 'M4', evidence: ['bundle dsh-evolution-host installed', 'family agent preset registered'], confidence: 'declared' }
        : { id: 'M3', evidence: ['bundle dsh-evolution-host installed'], confidence: 'declared' }
      : { id: 'M3', evidence: ['no family bundle was reported by the platform manager'], confidence: 'inferred' }
  const platformVersion = hostRuntimeVersion()
  const missingServices = SERVICES_PROBED.filter(name => get(name) === undefined)
  const host = hostSurface(ctx)
  const hostMounted = host.available
  return {
    now: extras.now ?? new Date(),
    platformLine: { version: PLATFORM_LINE.version, floor: PLATFORM_LINE.floor },
    familyVersion: familyVersion(),
    hostVersion: extras.hostVersion ?? platformVersion,
    form: extras.form ?? detectedForm,
    probes: { agentPresets: get('agentPresets') !== undefined, connection: get('connection') !== undefined },
    channels: { review, maintenance },
    presets: { reviewer: presetOf(REVIEWER_PRESET_ID), maintainer: presetOf(MAINTAINER_PRESET_ID) },
    host: {
      mounted: hostMounted,
      ...(hostMounted ? {} : { reason: host.reason }),
      ...(host.available ? { deploymentAllowsRemote: host.allowsRemoteAuthorities } : {}),
    },
    runs: extras.runs ?? { running: 0, orphaned: 0 },
    missingServices,
    sessionFoldClassifierPresent: typeof classifySessionEvent === 'function',
    platformPairing: extras.platformPairing ?? (platformVersion === undefined ? 'unknown' : platformVersion === PLATFORM_LINE.version ? 'in-window' : 'host-newer'),
  }
}
