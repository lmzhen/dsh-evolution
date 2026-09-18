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
import { PARAM_EXPOSURE, PARAM_NAMESPACES, type ParamExposure } from '@deepseek-ai/dsh-evolution-core'

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
export function renderParamRows(rows: readonly ParamSurfaceRow[], options: { providerMounted: boolean }): string {
  const header = 'PARAMETER'.padEnd(36) + 'GROUP'.padEnd(12) + 'TIER'.padEnd(5) + 'APPLIES'.padEnd(9) + 'SOURCE'.padEnd(14) + 'VALUE'
  const body = rows.map(row => row.id.padEnd(36) + row.group.padEnd(12) + row.tier.padEnd(5)
    + row.applies.padEnd(9) + row.source.padEnd(14) + renderValue(row.value))
  const tiers = ['E0', 'E1', 'E2', 'E3', 'E4']
    .map(tier => `${tier} ${rows.filter(row => row.tier === tier).length}`).join(' / ')
  const userRows = rows.filter(row => row.source === 'user').length
  // With no provider the override count is UNKNOWN, not zero: printing '0
  // overridden' would read as 'you have no overrides', which we cannot know.
  const overrides = options.providerMounted ? `${userRows} overridden by the user.` : 'overrides UNKNOWN (no settings provider).'
  const note = options.providerMounted
    ? 'SOURCE: user = you set it in settings; deployment = the row/policy value applies; unregistered = the owner publishes no user layer.'
    : 'settings provider not mounted — the user layer is unavailable, so every row shows its deployment face (this is NOT "no overrides").'
  return [header, ...body, '', `${rows.length} parameter(s): ${tiers}; ${overrides}`, note].join('\n')
}

/**
 * Render the rows as JSON for scripts (same fields, no formatting).
 * @param rows - rows from {@link paramSurfaceRows}.
 * @returns a JSON document with a `params` array.
 */
export function renderParamJson(rows: readonly ParamSurfaceRow[]): string {
  return JSON.stringify({ params: rows }, null, 2)
}
