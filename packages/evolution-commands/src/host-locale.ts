/** Host human-output locale: one resolver, output boundaries only. */
import type { Context } from '@deepseek-ai/cordis'
import { errorTextIn, HOST_LOCALES, type EvolutionErrorId, type HostLocale, type SettingsProviderLike } from '@deepseek-ai/dsh-evolution-core'
import { HOST_COMMANDS, type HostCommandKey } from './generated/host-commands.ts'

/**
 * Resolve the host human-output locale.
 * No preference keeps the authored Chinese; an explicit unknown locale falls back to English.
 * @param ctx - host context carrying the settings provider.
 * @returns the locale used for human-readable command output.
 */
export function resolveHostLocale(ctx: Pick<Context, 'get'>): HostLocale {
  try {
    // platform-declaration anchor: settings is a declared optional platform service; this probe only reads the locale row.
    const settings = ctx.get('settings') as SettingsProviderLike | undefined
    const value = settings?.describe?.({ redactSecrets: false })?.find(entry => entry.ns === 'locale')?.value
    const preference = typeof value === 'object' && value !== null ? (value as { preference?: unknown }).preference : undefined
    if (preference === undefined || preference === null) return 'zh'
    return HOST_LOCALES.includes(preference as HostLocale) ? preference as HostLocale : 'en'
  } catch {
    return 'zh'
  }
}

/**
 * Render one human-facing command-help line in the resolved host locale.
 * @param locale - resolved host locale.
 * @param key - stable command-help key.
 * @returns localized help text.
 */
export function hostCommandText(locale: HostLocale, key: HostCommandKey, values: Readonly<Record<string, string | number>> = {}): string {
  const template = HOST_COMMANDS[key][locale] ?? HOST_COMMANDS[key].zh
  return template.replace(/\{(\w+)\}/g, (match, slot: string) => values[slot] === undefined ? match : String(values[slot]))
}

/**
 * Render one human-facing error in the resolved host locale.
 * @param locale - resolved host locale.
 * @param id - stable error id.
 * @param args - values for %aN% slots.
 * @returns localized human error text.
 */
export function hostErrorText(locale: HostLocale, id: EvolutionErrorId, args: Record<string, string | number> = {}): string {
  return errorTextIn(locale, id, args)
}
