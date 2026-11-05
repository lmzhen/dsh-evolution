/** Presentation-only grouping of the existing namespaces; never a second settings schema. */
export type SettingsGroup = 'write' | 'organize' | 'memory'

const GROUP_OF: Readonly<Record<string, SettingsGroup>> = Object.freeze({
  'evolution-approval': 'write',
  'evolution-merge': 'write',
  'tool-skill-manage': 'write',
  'evolution-curator': 'organize',
  'evolution-commands': 'organize',
  'memory-files': 'memory',
  'tool-memory': 'memory',
  'evolution-review': 'memory',
})

/** Stable display order for the three task groups. */
export const SETTINGS_GROUP_ORDER: readonly SettingsGroup[] = ['write', 'organize', 'memory']

/**
 * Partition existing parameter cards by task. Unknown namespaces fall into organize so a future row
 * is visible rather than silently dropped.
 * @param cards - cards carrying only their namespace and payload.
 * @returns groups in display order, omitting empty groups.
 */
export function groupParamCards<T extends { readonly namespace: string }>(cards: readonly T[]): readonly { group: SettingsGroup; items: readonly T[] }[] {
  return SETTINGS_GROUP_ORDER.map(group => ({ group, items: cards.filter(card => (GROUP_OF[card.namespace] ?? 'organize') === group) }))
    .filter(entry => entry.items.length > 0)
}
