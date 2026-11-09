/**
 * Panel copy for the evolution workbench, generated from the family catalog and
 * registered through the platform's locale seat.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client/messages
 */
import { dictionariesFor, type SupportedLocale } from '@lmzhen/dsh-evolution-client-kit/generated/i18n'

/** Locale namespace this panel registers. */
export const NS = 'evolution-skill-history'

/** Every supported dictionary for this namespace. */
export const dictionaries = dictionariesFor(NS)
export const zh = dictionaries.zh
export const en = dictionaries.en
export const ja = dictionaries.ja

/**
 * Resolve one message without the locale seat.
 * @param key - the message key.
 * @param language - supported locale; defaults to English.
 * @returns the bundle copy.
 */
export function message(key: string, language: SupportedLocale = 'en'): string {
  const dictionary = dictionaries[language] as Readonly<Record<string, string>>
  return dictionary[key] ?? key
}

/**
 * Fill one template's `{slot}` placeholders.
 * @param template - the copy.
 * @param values - substitutions keyed by slot name.
 * @returns the filled copy.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, slot: string) => {
    const value = values[slot]
    return value === undefined ? match : String(value)
  })
}
