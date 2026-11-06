import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** One selectable language a family panel needs in the platform catalog. */
export interface FamilyLanguage {
  readonly id: string
  readonly label: string
  readonly fallback: string
}

interface LocaleSeatLike {
  getLocale?: () => { locales?: readonly { id: string }[] }
  getSnapshot?: () => { locales?: readonly { id: string }[] }
  addLanguage?: (input: FamilyLanguage) => () => void
}

/**
 * Ensure the platform's language catalog offers one language.
 *
 * A platform that already ships the language (0.2.2+ registers ja itself) is left alone;
 * an older catalog (0.2.1 line) gets the language added on the family's behalf. The call
 * is idempotent and never throws: the platform owns the catalog, and a refused
 * registration must degrade to the existing zh/en pair rather than break the panel.
 * @param ctx - the client context carrying the locale seat.
 * @param language - the language to offer.
 */
export function ensureLocaleLanguage(ctx: ClientContext, language: FamilyLanguage): void {
  const seat = (ctx as unknown as { locale?: LocaleSeatLike }).locale
  if (seat === undefined) return
  try {
    const snapshot = seat.getLocale?.() ?? seat.getSnapshot?.()
    if (snapshot?.locales?.some(item => item.id === language.id) === true) return
    seat.addLanguage?.(language)
  } catch {
    /* the platform owns the catalog; a refusal leaves the existing languages */
  }
}
