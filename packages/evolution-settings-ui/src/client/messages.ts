/**
 * Copy for the evolution parameter cards.
 *
 * The bundle carries its own dictionary: this package is distributed outside the
 * platform repository, whose typed locale seats are declared per in-repo
 * namespace. Components never inline a string — the card receives `t` through its
 * inject face, which is where a locale-service binding would plug in later.
 */

/** Message keys the cards render. */
export const MESSAGES = {
  title: 'Evolution parameters',
  overridden: 'user override',
  deployment: 'deployment value',
  loading: 'reading the settings document…',
  unavailable: 'this namespace is not served by the Host (its owning plugin row is not mounted)',
  readonly: 'the settings document is read-only in this session (memory mode)',
  apply: 'Apply',
  reset: 'Reset to deployment',
  empty: 'no writable field in this namespace',
} as const

/** One message key. */
export type MessageKey = keyof typeof MESSAGES

/**
 * Resolve one message.
 * @param key - the message key.
 * @returns the copy this bundle carries.
 */
export function message(key: MessageKey): string {
  return MESSAGES[key]
}
