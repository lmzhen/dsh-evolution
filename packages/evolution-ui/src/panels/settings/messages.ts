/**
 * Copy for the evolution settings section and its parameter cards.
 *
 * The generated dictionary is the single client source; this module keeps the
 * section's stable exports and the seat-free fallback used by tests and a refused
 * locale registration.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/messages
 */
import { dictionaries as generatedDictionaries } from '@lmzhen/dsh-evolution-client-kit/generated/i18n/evolution-settings'
import { fillTemplate as fill } from '@lmzhen/dsh-evolution-client-kit'
import type { SupportedLocale } from '@lmzhen/dsh-evolution-client-kit/generated/i18n'

/** Locale namespace this bundle registers. */
export const dictionaries = generatedDictionaries

export const NS = 'evolution-settings'

/** Every supported dictionary for this namespace. */

/** Chinese copy. */
export const zh = dictionaries.zh
/** English copy. */
export const en = dictionaries.en
/** Japanese copy. */
export const ja = dictionaries.ja

/** Card titles per settings namespace. A namespace without an entry falls back to its raw name. */
export const NAMESPACE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  'evolution-review': 'cardReview',
  'memory-files': 'cardMemory',
  'tool-memory': 'cardToolMemory',
  'evolution-curator': 'cardCurator',
  'tool-skill-manage': 'cardSkills',
  'evolution-approval': 'cardApproval',
  'evolution-commands': 'cardCommands',
  'evolution-merge': 'cardMerge',
})

/** One message key. */
export type MessageKey = keyof typeof zh

/**
 * Resolve one message without the locale seat.
 * @param key - the message key.
 * @param language - supported locale; defaults to English.
 * @returns the bundle copy, falling back to English and then the key.
 */
export function message(key: MessageKey, language: SupportedLocale = 'en'): string {
  const dictionary = dictionaries[language] as Readonly<Record<string, string>>
  return dictionary[key] ?? en[key] ?? key
}

/** Fill one template's `{slot}` placeholders through the shared client contract. */
export { fill }

/**
 * Resolve one message and fill its slots in one step.
 * @param key - the message key.
 * @param values - substitutions keyed by slot name.
 * @param language - supported locale; defaults to English.
 * @returns the copy a reader sees.
 */
export function formatText(key: MessageKey, values?: Readonly<Record<string, string | number>>, language: SupportedLocale = 'en'): string {
  const oneKey = (key + '.one') as MessageKey
  const singular = values?.n === 1 ? message(oneKey, language) : undefined
  const text = singular !== undefined && singular !== oneKey ? singular : message(key, language)
  return values === undefined ? text : fill(text, values)
}
