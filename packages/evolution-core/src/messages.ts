/**
 * Host-side message catalog shared by tool results and user-facing errors.
 *
 * Tool results and error copy are model- and user-facing text, so they need the same
 * translatability the client dictionaries already have — but they are produced in the
 * HOST half, where the platform locale seat does not exist. This module is the one
 * resolver: packages register a table of `source text → translations` and call
 * {@link tr} with the source string as the key (gettext shape: the Chinese text stays
 * the authoring source, translators fill the `en` / `ja` columns).
 *
 * The active locale comes from the platform's durable locale preference
 * (`settings.locale.preference`), installed by the policy plugin. Without a provider
 * (unit tests, direct library use) the locale is `zh`, so every existing assertion
 * keeps reading the authored text.
 * @module @deepseek-ai/dsh-evolution-core
 */

/** Locales this family can render host copy in. */
export type HostLocale = 'zh' | 'en' | 'ja'

/**
 * One package's translation table. Keys are the Chinese source strings used at the
 * call sites; a value of `''` (or a missing key) means "not translated yet".
 */
export interface HostMessages {
  readonly en?: Readonly<Record<string, string>>
  readonly ja?: Readonly<Record<string, string>>
}

const tables: HostMessages[] = []
let localeProvider: (() => HostLocale) | null = null
let cachedLocale: { readonly at: number; readonly value: HostLocale } | null = null

/**
 * Register one package's translation table. Tables are matched by identity, so a
 * re-registration (HMR, repeated module evaluation) is a no-op.
 * @param table - the package's `en` / `ja` columns.
 * @returns a disposer that removes the table again.
 */
export function registerHostMessages(table: HostMessages): () => void {
  if (!tables.includes(table)) tables.push(table)
  return () => {
    const index = tables.indexOf(table)
    if (index >= 0) tables.splice(index, 1)
  }
}

/**
 * Install the process-wide locale resolver (the policy plugin reads the platform
 * settings). Passing `null` restores the authored `zh` default.
 * @param provider - returns the active locale, or null to detach.
 * @returns a disposer restoring the previous provider.
 */
export function installHostLocale(provider: (() => HostLocale) | null): () => void {
  const previous = localeProvider
  localeProvider = provider
  cachedLocale = null
  return () => {
    localeProvider = previous
    cachedLocale = null
  }
}

/**
 * Resolve the active host locale. The provider is sampled at most once per second:
 * `settings.describe()` walks every entry, and tool results can be produced in bursts.
 * @returns the locale the host copy should render in.
 */
export function hostLocale(): HostLocale {
  if (localeProvider === null) return 'zh'
  const now = Date.now()
  if (cachedLocale !== null && now - cachedLocale.at < 1000) return cachedLocale.value
  let value: HostLocale = 'zh'
  try {
    const resolved = localeProvider()
    value = resolved === 'en' || resolved === 'ja' ? resolved : 'zh'
  } catch {
    value = 'zh'
  }
  cachedLocale = { at: now, value }
  return value
}

/**
 * Read the platform locale preference from the settings service, the way the browser
 * half does: the durable `locale` namespace's `preference` field. Absence (the browser
 * decides) has no host-side answer, so it falls back to `zh` — the authored language.
 * @param reader - something with the host `get(name)` (a cordis Context).
 * @returns the preference as a host locale.
 */
export function localeFromSettings(reader: { get(name: string): unknown }): HostLocale {
  try {
    const settings = reader.get('settings') as {
      describe?: () => ReadonlyArray<{ ns?: string; user?: { preference?: unknown } }>
    } | undefined
    const entry = settings?.describe?.().find(item => item?.ns === 'locale')
    const preference = entry?.user?.preference
    return preference === 'en' || preference === 'ja' ? preference : 'zh'
  } catch {
    return 'zh'
  }
}

/**
 * Translate one piece of host copy through the registered tables, falling back key by
 * key: active locale → English → the authored source text.
 * @param source - the Chinese source string (the table key).
 * @param params - values for `{name}` slots; an unknown slot is left standing.
 * @returns the translated copy, or the source when nothing is registered.
 */
export function tr(source: string, params?: Readonly<Record<string, string | number>>): string {
  return trIn(hostLocale(), source, params)
}

/**
 * Translate in an explicit locale (tests and locale-specific assertions). The same
 * fallback chain applies: requested locale → English → source.
 * @param locale - the locale to render in.
 * @param source - the Chinese source string.
 * @param params - values for `{name}` slots.
 * @returns the translated copy, or the source when nothing is registered.
 */
export function trIn(locale: HostLocale, source: string, params?: Readonly<Record<string, string | number>>): string {
  const lookup = (key: 'en' | 'ja'): string | undefined => {
    for (const table of tables) {
      const value = table[key]?.[source]
      if (typeof value === 'string' && value !== '') return value
    }
    return undefined
  }
  let text = source
  if (locale === 'ja') text = lookup('ja') ?? lookup('en') ?? source
  else if (locale === 'en') text = lookup('en') ?? source
  return fill(text, params)
}

/**
 * Fill one template's `{slot}` placeholders. A missing value is left standing so a
 * mistake cannot print `undefined` into a tool result.
 * @param template - the resolved copy.
 * @param params - substitution values.
 * @returns the filled copy.
 */
function fill(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
}

/**
 * Core's translation column for tool-result and error copy. Keys are the Chinese
 * source strings used at the call sites; `''` means "not translated yet" (the
 * resolver falls back to the source text). Translators fill the `en` / `ja` values;
 * the gate `verify-host-messages.mjs` keeps the key sets identical to the call sites.
 */
export const CORE_MESSAGES: HostMessages = {
  en: {},
  ja: {},
}

registerHostMessages(CORE_MESSAGES)
