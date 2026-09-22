/**
 * `/evolution params` view (G4/S4.1): the registry joined with the settings
 * surface, so one text answers "which parameters exist, who may write them, and
 * did I already override this one".
 *
 * The join key is the OWNER PACKAGE: core's `PARAM_NAMESPACES` maps a package to
 * the one namespace it registers, and `settings.describe()` reports that
 * namespace's raw user section (a key's PRESENCE is the override) plus the
 * resolved value. Everything here is pure; the command handler supplies the data.
 * @module @deepseek-ai/dsh-evolution-commands/params
 */
import { PARAM_EXPOSURE, PARAM_GROUP_LABELS, PARAM_NAMESPACES, type ParamExposure } from '@deepseek-ai/dsh-evolution-core'

/** One registered namespace, as `settings.describe()` reports it. */
export interface ParamSectionView {
  /** Raw user section: a key's presence marks a user override. */
  user?: Record<string, unknown> | undefined
  /** Resolved section (schema defaults < base < user). */
  value?: Record<string, unknown> | undefined
}

/** Which face a row's value comes from. */
export type ParamSource = 'user' | 'deployment' | 'unregistered'

/** One parameter as the command renders it. */
export interface ParamSurfaceRow {
  id: string
  group: ParamExposure['group']
  tier: ParamExposure['tier']
  /** Settings-side timing: live, restart, or none (not user-writable). */
  applies: ParamExposure['applies']
  owner: string
  source: ParamSource
  /** What that face holds, or undefined when no face reports a value. */
  value: unknown
}

/**
 * Join the registry with the settings surface.
 *
 * `user` means the raw user section carries this key; `deployment` means the
 * owner's namespace is registered but the key is unset (so the row/policy value
 * applies); `unregistered` means the owner package publishes no namespace at all
 * (or is not mounted), which is the honest answer for a deployment-only face.
 * The distinction matters: 'no user section' must never read as 'not overridden'
 * for a namespace that failed to register.
 * @param sections - namespace to surface view, from `settings.describe()`.
 * @param entries - registry entries (defaults to the family registry).
 * @returns one row per registry entry, in registry order.
 */
export function paramSurfaceRows(
  sections: ReadonlyMap<string, ParamSectionView>,
  entries: readonly ParamExposure[] = PARAM_EXPOSURE,
): ParamSurfaceRow[] {
  return entries.map((entry) => {
    const base = { id: entry.id, group: entry.group, tier: entry.tier, applies: entry.applies, owner: entry.owner }
    const namespace = PARAM_NAMESPACES[entry.owner]
    const section = namespace === undefined ? undefined : sections.get(namespace)
    if (section === undefined) return { ...base, source: 'unregistered' as const, value: undefined }
    const user = section.user
    if (user !== undefined && Object.hasOwn(user, entry.id)) return { ...base, source: 'user' as const, value: user[entry.id] }
    return { ...base, source: 'deployment' as const, value: section.value?.[entry.id] }
  })
}

/**
 * The groups the registry actually carries, in registry order — the list an
 * unknown `--group` value is answered with.
 * @param entries - registry entries (defaults to the family registry).
 * @returns distinct group names.
 */
export function paramGroups(entries: readonly ParamExposure[] = PARAM_EXPOSURE): string[] {
  return [...new Set(entries.map(entry => entry.group))]
}

/** One cell: `—` when no face reports a value, JSON for arrays/objects. */
function renderValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Render the rows as fixed-width text (one parameter per line, never truncated).
 * @param rows - rows from {@link paramSurfaceRows}.
 * @param options - whether the settings service answered at all.
 * @returns the command text.
 */
/** Display width: a CJK or fullwidth character occupies two terminal columns. */
const WIDE_RANGES = ['\u1100-\u115f', '\u2e80-\u303e', '\u3041-\u33ff', '\u3400-\u4dbf', '\u4e00-\u9fff',
  '\uac00-\ud7a3', '\uf900-\ufaff', '\ufe30-\ufe6f', '\uff00-\uff60', '\uffe0-\uffe6']
const WIDE_CHAR = new RegExp('[' + WIDE_RANGES.join('') + ']')

/**
 * Pad one cell to a display width, counting CJK characters as two columns.
 * @param text - the cell text.
 * @param columns - the target width in terminal columns.
 * @returns the text plus at least one space, so columns never touch.
 */
function pad(text: string, columns: number): string {
  let used = 0
  for (const char of text) used += WIDE_CHAR.test(char) ? 2 : 1
  return text + ' '.repeat(Math.max(1, columns - used))
}

/** Settings timing, in the operator's words. */
const APPLIES_LABELS: Readonly<Record<string, string>> = Object.freeze({ live: '立即', restart: '重启后', none: '不生效' })

/** Where a row's effective value comes from, in the operator's words. */
const SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({ user: '我改过', deployment: '默认', unregistered: '不可改' })

/** What the E-tiers mean, so the count line reads without the docs. */
const TIER_LEGEND = '档位：E0 固定／E1 只读／E2 安装时定／E3 你可改／E4 装完固化。'

export function renderParamRows(rows: readonly ParamSurfaceRow[], options: { providerMounted: boolean }): string {
  const header = pad('参数', 36) + pad('分组', 12) + pad('档位', 6) + pad('生效', 8) + pad('来源', 10) + '当前值'
  const body = rows.map(row => pad(row.id, 36) + pad(PARAM_GROUP_LABELS[row.group], 12) + pad(row.tier, 6)
    + pad(APPLIES_LABELS[row.applies] ?? row.applies, 8) + pad(SOURCE_LABELS[row.source] ?? row.source, 10) + renderValue(row.value))
  const tiers = ['E0', 'E1', 'E2', 'E3', 'E4']
    .map(tier => `${tier} ${rows.filter(row => row.tier === tier).length}`).join(' / ')
  const userRows = rows.filter(row => row.source === 'user').length
  // Without a settings provider the override count is UNKNOWN, not zero: printing
  // '你改过的：0 项' would read as 'you changed nothing', which we cannot know.
  const counts = options.providerMounted
    ? `共 ${rows.length} 个参数：${tiers}；你改过的：${userRows} 项。`
    : `共 ${rows.length} 个参数：${tiers}；是否改过：未知（没有设置服务）。`
  const note = options.providerMounted
    ? '来源：我改过＝你在设置里改的；默认＝安装时的配置；不可改＝该功能不提供用户可改项。'
    : '设置服务未挂载——读不到你改过的值，所以每行显示的都是安装时的配置（这不等于「你没改过」）。'
  return [header, ...body, '', counts, TIER_LEGEND, note].join('\n')
}

/**
 * Parse one command-line value into what the settings document stores: JSON
 * when it parses (numbers, booleans, quoted strings, arrays, objects), the raw
 * text otherwise, so a bare word like `enforce` stays a word.
 * @param raw - the text typed after the parameter id.
 * @returns the value to write.
 */
export function parseParamValue(raw: string): unknown {
  const text = raw.trim()
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Not JSON: the schema decides whether a bare word is legal (enums) or not.
    return text
  }
}

/** One accepted write, as the command echoes it back. */
export interface ParamWriteEcho {
  id: string
  namespace: string
  applies: ParamExposure['applies']
  before: unknown
  after: unknown
  /** Whether the user section already carried this key. */
  wasOverridden: boolean
}

/**
 * Render the write result: the value move, then where it landed and when it
 * takes effect (the two things a caller cannot infer from the command line).
 * @param write - the accepted write.
 * @returns the command text.
 */
export function renderPolicySet(write: ParamWriteEcho): string {
  const timing = write.applies === 'live'
    ? 'takes effect at the next use (live)'
    : 'takes effect after a host restart (restart)'
  const origin = write.wasOverridden ? 'replacing your earlier override' : 'now a user override (the deployment value stays underneath)'
  return [`${write.id}: ${renderValue(write.before)} → ${renderValue(write.after)}`,
    `namespace ${write.namespace}; applies ${write.applies} — ${timing}; ${origin}`].join('\n')
}

/**
 * Render the rows as JSON for scripts (same fields, no formatting).
 * @param rows - rows from {@link paramSurfaceRows}.
 * @returns a JSON document with a `params` array.
 */
export function renderParamJson(rows: readonly ParamSurfaceRow[]): string {
  return JSON.stringify({ params: rows }, null, 2)
}
