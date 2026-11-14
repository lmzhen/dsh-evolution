import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { LocaleDictionaries } from './seam.ts'
import type { SupportedLocale } from './generated/i18n.generated.ts'

export const FALLBACK_LOCALE = 'en' as const

/** Dictionary lookup used by the panel body and row label. */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

function interpolate(text: string, values?: Readonly<Record<string, string | number>>): string {
  if (values === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''))
}

/**
 * Fill `{slot}` placeholders, keeping an unmatched placeholder visible.
 * This is the panel-copy contract (a missing value is a bug to see, not an empty string).
 */
export function fillTemplate(text: string, values?: Readonly<Record<string, string | number>>): string {
  if (values === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

/** Register one namespace's dictionaries and bind a fallback-first lookup. */
export function bindLocale(
  ctx: ClientContext,
  namespace: string,
  dictionaries: LocaleDictionaries,
  fallback: SupportedLocale = FALLBACK_LOCALE,
  register = true,
): { readonly t: Translate; readonly label: () => string } {
  const seam = ctx as unknown as { readonly locale: { register(namespace: string, dictionaries: LocaleDictionaries): () => void; bind(namespace: string): (key: string) => string } }
  let registered = !register
  if (register) {
    ctx.effect(() => {
      try {
        const dispose = seam.locale.register(namespace, dictionaries)
        registered = true
        return dispose
      } catch (error) {
        ctx.logger.warn(namespace + ': the locale seat refused the dictionary (' + String(error) + '); falls back to the bundle copy')
        return () => {}
      }
    }, namespace + ': locale')
  }
  const own = dictionaries[fallback] ?? dictionaries.en
  const lookup = (key: string): string => {
    const fallbackText = own[key] ?? key
    if (!registered) return fallbackText
    try { return seam.locale.bind(namespace)(key) } catch { return fallbackText }
  }
  return {
    t: (key, values) => interpolate(lookup(key), values),
    label: () => lookup('entry.label'),
  }
}
