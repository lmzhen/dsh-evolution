/** Host human-output locale: one resolver, output boundaries only. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProviderLike } from '@deepseek-ai/dsh-evolution-core'
import { HOST_ERRORS, HOST_LOCALES, type HostErrorId, type HostLocale } from './generated/host-errors.ts'

/**
 * Resolve the host human-output locale.
 * No preference keeps the authored Chinese; an explicit unknown locale falls back to English.
 * @param ctx - host context carrying the settings provider.
 * @returns the locale used for human-readable command output.
 */
export function resolveHostLocale(ctx: Pick<Context, 'get'>): HostLocale {
  try {
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
 * Render one human-facing error in the resolved host locale.
 * @param locale - resolved host locale.
 * @param id - stable error id.
 * @param args - values for %aN% slots.
 * @returns localized human error text.
 */
export function hostErrorText(locale: HostLocale, id: HostErrorId, args: Record<string, string | number> = {}): string {
  const row = HOST_ERRORS[id]
  const template = row[locale] ?? row.en
  return template.replace(/%a(\d+)%/g, (_match, n: string) => String(args['a' + n] ?? ''))
}
