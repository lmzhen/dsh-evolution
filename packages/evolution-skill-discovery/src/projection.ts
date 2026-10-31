import { sanitizeUntrustedText } from './security.ts'
import {
  projectionDigestOf,
  type SkillIndexRow,
  type SkillKey,
} from './identity.ts'

/** One skill entry from the platform catalog message. */
export interface CatalogEntry {
  readonly name: string
  readonly description: string
}

/** One model-visible L1 domain card. */
export interface DomainCard {
  readonly id: string
  readonly title: string
  readonly purpose: string
  readonly triggers: readonly string[]
  readonly descriptionStatus: 'fresh' | 'stale' | 'failed'
  readonly managedModelInvocableCount: number
  readonly externalCatalogCount: number
  readonly managedCount: number
  readonly externalCount: number
  readonly pendingCount: number
  readonly state: 'active' | 'provisional'
  readonly asOf: string
  readonly mapVersion: string
  readonly mapStale: boolean
}

/** Input of the pure catalog projection contract. */
export interface ProjectionInput {
  readonly entries: readonly CatalogEntry[]
  readonly rows: readonly SkillIndexRow[]
  readonly activeManagedSkillKeys: ReadonlySet<SkillKey>
  readonly cards: readonly DomainCard[]
  readonly viewKey: string
  readonly scope: string
  readonly mapVersion: string
  readonly policyDigest: string
  readonly viewCatalogDigest: string
  readonly adapterVersion: string
  readonly projectionSchemaVersion: string
  readonly discoveryMode: string
  readonly complete: boolean
}

/** Output of the pure catalog projection contract. */
export interface ProjectionResult {
  readonly catalogEntries: readonly CatalogEntry[]
  readonly context: string
  readonly hiddenNames: readonly string[]
  readonly shadowHiddenNames?: readonly string[]
  readonly shadowRecoveredNames?: readonly string[]
  readonly scope: string
  readonly digest: string
  readonly complete: boolean
}

function escapeData(value: string): string {
  return sanitizeUntrustedText(value, 2000).text
}

function renderCards(cards: readonly DomainCard[]): string {
  if (cards.length === 0) return ''
  const lines = [
    '<system-reminder>',
    'Domain cards summarize where skills cluster; they support awareness, not retrieval. skill_search matches task text to skill summaries, skill(name) loads an exact skill, and the full catalog remains the fallback.',
    '<skill_domains>',
    ...cards.map(card => [
      '- ',
      escapeData(card.id),
      ' ',
      escapeData(card.title),
      ': ',
      escapeData(card.purpose),
      ' triggers=',
      card.triggers.map(escapeData).join(','),
      ' | managed=',
      String(card.managedModelInvocableCount),
      ' external=',
      String(card.externalCatalogCount),
      ' pending=',
      String(card.pendingCount),
      ' state=',
      card.state,
      ' descriptionStatus=',
      card.descriptionStatus,
      ' asOf=',
      escapeData(card.asOf),
      ' mapVersion=',
      escapeData(card.mapVersion),
      ' mapStale=',
      String(card.mapStale),
    ].join('')),
    '</skill_domains>',
    '</system-reminder>',
  ]
  return lines.join('\n')
}

/**
 * Pure catalog projection: hide only active managed entries, preserve every
 * other entry, and render L1 cards. Incomplete input fails open.
 * @param input - view rows, active managed keys, cards, and identity inputs.
 * @returns projected entries/context/hidden names and digest.
 */
export function projectCatalog(input: ProjectionInput): ProjectionResult {
  if (!input.complete) {
    return {
      catalogEntries: input.entries,
      context: '',
      hiddenNames: [],
      scope: input.scope,
      digest: projectionDigestOf({
        viewKey: input.viewKey,
        mapVersion: input.mapVersion,
        policyDigest: input.policyDigest,
        viewCatalogDigest: input.viewCatalogDigest,
        adapterVersion: input.adapterVersion,
        projectionSchemaVersion: input.projectionSchemaVersion,
        discoveryMode: input.discoveryMode,
      }),
      complete: false,
    }
  }

  const activeByName = new Map<string, SkillIndexRow>()
  for (const row of input.rows) {
    if (row.managed && row.modelInvocable && !row.protected && input.activeManagedSkillKeys.has(row.skillKey)) {
      activeByName.set(row.name, row)
    }
  }
  const hiddenNames = input.entries
    .filter(entry => activeByName.has(entry.name))
    .map(entry => entry.name)
    .sort()
  const hidden = new Set(hiddenNames)
  const catalogEntries = input.entries.filter(entry => !hidden.has(entry.name))
  return {
    catalogEntries,
    context: renderCards(input.cards),
    hiddenNames,
    scope: input.scope,
    digest: projectionDigestOf({
      viewKey: input.viewKey,
      mapVersion: input.mapVersion,
      policyDigest: input.policyDigest,
      viewCatalogDigest: input.viewCatalogDigest,
      adapterVersion: input.adapterVersion,
      projectionSchemaVersion: input.projectionSchemaVersion,
      discoveryMode: input.discoveryMode,
    }),
    complete: true,
  }
}
