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
  'platform-line': '平台兼容线',
  'family-version': '家族版本',
  'install-form': '安装形态',
  'preset-ids': '受限 preset id',
  'readonly-contract': '只读契约',
  'upgrade-order': '升级顺序',
  'fallback-map': '命令兜底',
}

const RUNTIME_LABELS: Readonly<Record<string, string>> = {
  'subagent-channel': '子代理通道',
  'restricted-preset': '受限 preset',
  'host-surface': 'Host 数据面',
  'session-fold': '会话事件 fold 单入口',
  'platform-services': '平台服务探测',
  runs: '运行登记',
  'platform-pairing': '平台/家族配对',
  'install-form-detected': '实际安装形态',
}

function factsOf(inputs: DoctorInputs): DocFactRow[] {
  const values: Record<string, string> = {
    'platform-line': inputs.platformLine.version + '（floor ' + inputs.platformLine.floor + '）',
    'family-version': inputs.familyVersion,
    'install-form': inputs.form.id + '（' + inputs.form.confidence + '；证据：' + inputs.form.evidence.join('、') + '）',
    'preset-ids': REVIEWER_PRESET_ID + ' / ' + MAINTAINER_PRESET_ID + '（家族 preset 集合：' + EVOLUTION_PRESET_IDS.join(', ') + '）',
    'readonly-contract': REVIEWER_PRESET_ID + ' 的工具集由 restrictor allow 集合决定；维护行同构（' + MAINTAINER_PRESET_ID + '）',
    'upgrade-order': '先升平台 → 再升家族 → 最后发布（见 INSTALL runbook）',
    'fallback-map': Object.keys(COMMAND_FALLBACKS).join('、') + '（每面的命令见 INSTALL 命令兜底表）',
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
    return { key: 'subagent-channel', label: RUNTIME_LABELS['subagent-channel'] ?? '子代理通道', status: 'ok', detail: 'reviewer/maintainer 通道均可用（spawn provider + agentPreset 能力）' }
  }
  const reasons = unavailable.map(state => state.code + ': ' + state.reason)
  return {
    key: 'subagent-channel',
    label: RUNTIME_LABELS['subagent-channel'] ?? '子代理通道',
    status: 'warn',
    detail: reasons.join('；'),
    remedy: '显式子代理运行会标记为不可用（不会静默退回 inject）；运行 /evolution doctor 查看修复指引。',
  }
}

function presetRow(presets: DoctorInputs['presets']): DiagnosticRow {
  const entries = [presets.reviewer, presets.maintainer]
  if (entries.every(entry => entry === undefined)) {
    return { key: 'restricted-preset', label: RUNTIME_LABELS['restricted-preset'] ?? '受限 preset', status: 'unknown', detail: 'agentPresets 未挂载或未暴露 list()，无法探测受限 preset。', remedy: '挂载 agentPresets（随平台 Web 组合）后运行 /evolution doctor。' }
  }
  const broken = entries.filter((entry): entry is PresetFacts => entry !== undefined && entry.broken !== undefined)
  const missing = entries.filter(entry => entry === undefined || !entry.registered)
  if (broken.length > 0) {
    return { key: 'restricted-preset', label: RUNTIME_LABELS['restricted-preset'] ?? '受限 preset', status: 'fail', detail: 'E-324: ' + broken.map(entry => entry.broken ?? '').join('；'), remedy: '重载插件行使 ensureRestrictedPreset 重新注册；运行 /evolution doctor 查看 preset id 与 allow 集合。' }
  }
  if (missing.length > 0) {
    return { key: 'restricted-preset', label: RUNTIME_LABELS['restricted-preset'] ?? '受限 preset', status: 'warn', detail: '受限 preset 尚未注册（首次显式子代理运行时创建）。', remedy: '运行一次审阅/维护，或在挂载后运行 /evolution doctor。' }
  }
  return { key: 'restricted-preset', label: RUNTIME_LABELS['restricted-preset'] ?? '受限 preset', status: 'ok', detail: REVIEWER_PRESET_ID + ' / ' + MAINTAINER_PRESET_ID + ' 均已注册' }
}

function hostRow(host: DoctorInputs['host'], count: DoctorInputs['hostRouteCount']): DiagnosticRow {
  if (!host.mounted) {
    const fallback = COMMAND_FALLBACKS.approval.command.split(' … ')[0] ?? ''
    return {
      key: 'host-surface',
      label: RUNTIME_LABELS['host-surface'] ?? 'Host 数据面',
      status: 'warn',
      detail: 'E-325: connection 不可用（' + (host.reason ?? 'unknown') + '），面板与审批路由未注册。',
      remedy: '改用命令面完成同等操作：' + fallback + ' 等；运行 /evolution doctor 查看已挂载服务。',
    }
  }
  const remote = host.deploymentAllowsRemote === true ? '允许远程权限（平台准入策略原样报告）' : '仅本机权限（平台准入策略原样报告）'
  const mounted = count === undefined ? '已挂载' : '已挂载 ' + String(count.mounted) + '/' + String(count.total)
  return { key: 'host-surface', label: RUNTIME_LABELS['host-surface'] ?? 'Host 数据面', status: 'ok', detail: mounted + '；' + remote }
}

function pairingRow(inputs: DoctorInputs): DiagnosticRow {
  const status = inputs.platformPairing ?? 'unknown'
  switch (status) {
    case 'in-window':
      return { key: 'platform-pairing', label: RUNTIME_LABELS['platform-pairing'] ?? '平台/家族配对', status: 'ok', detail: '宿主版本 ' + String(inputs.hostVersion) + ' 在兼容窗口 ' + inputs.platformLine.version + ' 内' }
    case 'host-newer':
      return { key: 'platform-pairing', label: RUNTIME_LABELS['platform-pairing'] ?? '平台/家族配对', status: 'warn', detail: '宿主 patch 线已更新（' + String(inputs.hostVersion) + '，家族声明 ' + inputs.platformLine.version + '）。', remedy: '按升级 runbook 先升平台线再升家族。' }
    case 'out-of-window':
      return { key: 'platform-pairing', label: RUNTIME_LABELS['platform-pairing'] ?? '平台/家族配对', status: 'fail', detail: '宿主版本 ' + String(inputs.hostVersion) + ' 落在兼容窗口（floor ' + inputs.platformLine.floor + '）外。', remedy: '先升/降平台到兼容窗口，再重载家族。' }
    case 'unknown':
      return { key: 'platform-pairing', label: RUNTIME_LABELS['platform-pairing'] ?? '平台/家族配对', status: 'unknown', detail: inputs.hostVersion === undefined ? '读不到宿主版本。' : '无法判定版本窗口。', remedy: '在宿主会话里运行 /evolution doctor。' }
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
      ? { key: 'session-fold', label: RUNTIME_LABELS['session-fold'] ?? '会话事件 fold 单入口', status: 'ok', detail: 'classifySessionEvent/isIgnorableEvent 存在：model 消费，plugin-record/unknown 忽略。' }
      : { key: 'session-fold', label: RUNTIME_LABELS['session-fold'] ?? '会话事件 fold 单入口', status: 'fail', detail: '分类器缺失，无法证明单一 fold 入口。', remedy: '升级家族（classifySessionEvent 是 core 根导出）。' },
    missing.length === 0
      ? { key: 'platform-services', label: RUNTIME_LABELS['platform-services'] ?? '平台服务探测', status: 'ok', detail: '探测表中的服务均已挂载' }
      : { key: 'platform-services', label: RUNTIME_LABELS['platform-services'] ?? '平台服务探测', status: 'warn', detail: '缺少：' + missing.join('、'), remedy: '安装行（evolution-host/evolution-all）或检查 profile 行。' },
    inputs.runs.orphaned > 0
      ? { key: 'runs', label: RUNTIME_LABELS.runs ?? '运行登记', status: 'warn', detail: 'running=' + String(inputs.runs.running) + '，orphaned=' + String(inputs.runs.orphaned), remedy: '运行 /evolution runs 收敛遗留运行。' }
      : { key: 'runs', label: RUNTIME_LABELS.runs ?? '运行登记', status: 'ok', detail: 'running=' + String(inputs.runs.running) + '，orphaned=0' },
    pairingRow(inputs),
    inputs.form.confidence === 'declared'
      ? { key: 'install-form-detected', label: RUNTIME_LABELS['install-form-detected'] ?? '实际安装形态', status: 'ok', detail: inputs.form.id + '（声明）' }
      : { key: 'install-form-detected', label: RUNTIME_LABELS['install-form-detected'] ?? '实际安装形态', status: 'warn', detail: inputs.form.id + '（推断：' + inputs.form.evidence.join('、') + '）', remedy: '在 profile 里显式声明安装行，核对 INSTALL 的形态表。' },
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
  const runtime: DiagnosticRow[] = DIAGNOSTICS_RUNTIME_KEYS.map(key => ({ key, label: RUNTIME_LABELS[key] ?? key, status: 'unknown', detail: '无法装配 doctor 输入：' + reason, remedy: '运行 /evolution doctor 重试；若持续失败，检查宿主日志。' }))
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
  const detectedForm: DoctorInputs['form'] = hasAll || hasPreset
    ? { id: 'M1', evidence: [hasAll ? 'bundle dsh-evolution-all installed' : 'bundle dsh-evolution-preset installed'], confidence: 'declared' }
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
