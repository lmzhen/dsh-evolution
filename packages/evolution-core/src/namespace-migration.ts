/**
 * G3: the one-time move of the family's LEGACY settings sections into the row ids the
 * platform keys settings by now.
 *
 * On 0.1.x each plugin registered a free-form namespace (`evolution-memory`, …) through the
 * family's own seam. The platform derives a settings namespace from the Loader entry id
 * today, so those old strings address nothing: the platform's own legacy import finds no
 * such entry, warns, and leaves the values in the renamed document. This module reads that
 * document, maps each legacy section (and each deprecated key spelling) onto its row, and
 * merges the values into that row's user layer.
 *
 * Two halves, both testable without a host: {@link planNamespaceMigration} is pure (text in,
 * plan out) and {@link applyNamespaceMigration} takes the few things it needs as
 * dependencies, so the side-effecting half runs against a fake settings seat.
 * @module @deepseek-ai/dsh-evolution-core
 */
import { parse as parseYaml } from 'yaml'
import { NAMESPACE_MIGRATIONS, PARAM_ALIASES, PARAM_EXPOSURE, resolveParamId } from './params.ts'

/** One value a legacy section carried, with the spelling it used. */
export interface NamespaceMigrationValue {
  /** The key as the legacy document spelled it (canonical or deprecated alias). */
  readonly source: string
  /** The canonical registry id the value is written under. */
  readonly key: string
  /** The parsed value. */
  readonly value: unknown
}

/** One row's migration target. */
export interface NamespaceMigrationEntry {
  /** The legacy section the values sit in. */
  readonly namespace: string
  /** The row id the platform keys the settings by now. */
  readonly rowId: string
  /** The values to merge into that row, in document order. */
  readonly values: readonly NamespaceMigrationValue[]
}

/** One legacy key no row may take. */
export interface NamespaceMigrationSkip {
  /** The legacy section it sat in. */
  readonly namespace: string
  /** The key as spelled. */
  readonly key: string
  /** Why it is not migrated. */
  readonly reason: string
}

/** What a legacy document asks for. */
export interface NamespaceMigrationPlan {
  /** One entry per legacy section that carried values a row can take. */
  readonly entries: readonly NamespaceMigrationEntry[]
  /** Legacy sections the family knows but that carried nothing mappable. */
  readonly empty: readonly string[]
  /** Top-level sections that are not family legacy sections (the platform's own). */
  readonly foreign: readonly string[]
  /** Keys that were found but not migrated. */
  readonly skipped: readonly NamespaceMigrationSkip[]
}

/**
 * Whether a parsed value is a plain mapping (a settings section).
 * @param value - the parsed value.
 * @returns true for a non-null, non-array object.
 */
function isSection(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The key names one row may be written with: its own E3 rows, plus the deprecated
 * spellings that still resolve to them. An unknown key is refused instead of written —
 * the platform validates a write against the row's schema, so writing it would fail the
 * whole row's migration.
 * @param rowId - the row's entry id.
 * @returns every key name a legacy section may carry for that row.
 */
function writableKeys(rowId: string): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const entry of PARAM_EXPOSURE) {
    if (entry.owner === rowId && entry.tier === 'E3') keys.add(entry.id)
  }
  for (const [alias, canonical] of Object.entries(PARAM_ALIASES)) {
    if (keys.has(canonical)) keys.add(alias)
  }
  return keys
}

/**
 * Read one legacy settings document into a migration plan.
 *
 * Pure: the caller reads the file (the platform's renamed `settings.yaml.imported` first,
 * then a `settings.yaml` the platform has not imported yet) and hands the text over.
 * @param documentText - the YAML document text.
 * @returns what to write, what the family knows but need not touch, and what it refused.
 * @throws {Error} when the document is not a mapping, or a family section is not one.
 */
export function planNamespaceMigration(documentText: string): NamespaceMigrationPlan {
  const parsed: unknown = parseYaml(documentText)
  if (parsed === undefined || parsed === null) return { entries: [], empty: [], foreign: [], skipped: [] }
  if (!isSection(parsed)) throw new Error('the settings document is not a mapping; refusing to migrate it')
  const legacy = new Map(NAMESPACE_MIGRATIONS.map(entry => [entry.namespace, entry.rowId]))
  const entries: NamespaceMigrationEntry[] = []
  const empty: string[] = []
  const skipped: NamespaceMigrationSkip[] = []
  for (const [namespace, section] of Object.entries(parsed)) {
    const rowId = legacy.get(namespace)
    if (rowId === undefined) continue
    if (!isSection(section)) throw new Error('settings section `' + namespace + '` is not a mapping; refusing to migrate it')
    const allowed = writableKeys(rowId)
    const values: NamespaceMigrationValue[] = []
    for (const [key, value] of Object.entries(section)) {
      const canonical = resolveParamId(key)
      if (!allowed.has(canonical)) {
        skipped.push({ namespace, key, reason: 'row `' + rowId + '` has no such parameter' })
        continue
      }
      values.push({ source: key, key: canonical, value })
    }
    if (values.length === 0) empty.push(namespace)
    else entries.push({ namespace, rowId, values })
  }
  const foreign = Object.keys(parsed).filter(name => !legacy.has(name)).sort()
  return { entries, empty, foreign, skipped }
}

/** One key the target row already carried. */
export interface NamespaceMigrationConflict {
  /** The row id. */
  readonly rowId: string
  /** The canonical key. */
  readonly key: string
  /** The value the stored row already holds — it wins. */
  readonly current: unknown
  /** The legacy value that was NOT applied. */
  readonly legacy: unknown
}

/** What one run did. */
export interface NamespaceMigrationReport {
  /** Rows the run wrote, with the keys it merged. */
  readonly written: readonly { readonly rowId: string; readonly keys: readonly string[] }[]
  /** Keys whose stored value won over the legacy one. */
  readonly conflicts: readonly NamespaceMigrationConflict[]
  /** Keys the target row already held the same value for: no write was needed. */
  readonly unchanged: readonly { readonly rowId: string; readonly key: string }[]
  /** Keys the plan refused (see {@link NamespaceMigrationSkip}). */
  readonly skipped: readonly NamespaceMigrationSkip[]
}

/** Everything {@link applyNamespaceMigration} needs from its caller. */
export interface NamespaceMigrationDeps {
  /**
   * The row's CURRENT user layer, as `settings.describe()` reports it — the raw user
   * section, not the resolved value: presence of a key is what marks an override.
   * @param rowId - the row id.
   * @returns the describe view, or undefined when the platform serves no such row.
   */
  read(rowId: string): { readonly user?: Record<string, unknown> | undefined } | undefined
  /**
   * Merge one row's values (the platform's `settings.update` — merge semantics).
   * @param rowId - the row id.
   * @param patch - canonical key to value, the keys the row does not already carry.
   * @returns settlement after the write is accepted.
   */
  update(rowId: string, patch: Readonly<Record<string, unknown>>): Promise<void>
  /**
   * Report one value that was found and not applied.
   * @param message - the warning text.
   */
  warn(message: string): void
}

/**
 * Whether two JSON-shaped config values are the same value.
 * @param left - one value.
 * @param right - the other.
 * @returns true when both serialize identically.
 */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
/** One row's pending write: the keys that row does not carry yet. */
export interface NamespaceMigrationWrite {
  /** The row id. */
  readonly rowId: string
  /** Canonical key to legacy value, for the keys the row does not already hold. */
  readonly patch: Readonly<Record<string, unknown>>
}

/** What a plan would do against the live document, decided without writing anything. */
export interface NamespaceMigrationClassification {
  /** The rows to write, one entry per row. */
  readonly write: readonly NamespaceMigrationWrite[]
  /** Keys whose stored value won over the legacy one. */
  readonly conflicts: readonly NamespaceMigrationConflict[]
  /** Keys the row already held the same value for. */
  readonly unchanged: readonly { readonly rowId: string; readonly key: string }[]
  /** The plan's refusals, plus the keys of a row this composition does not serve. */
  readonly skipped: readonly NamespaceMigrationSkip[]
}

/**
 * Decide what a plan would do: the rows it would write, the keys already equal, the stored
 * values that win, and the refusals. The write half and the read-only doctor read the SAME
 * decision here — one rule, two consumers, so a report can never disagree with a run.
 * @param plan - the plan from {@link planNamespaceMigration}.
 * @param read - the row's current user layer (see {@link NamespaceMigrationDeps.read}).
 * @returns the decision; nothing is written.
 */
export function classifyNamespaceMigration(
  plan: NamespaceMigrationPlan,
  read: NamespaceMigrationDeps['read'],
): NamespaceMigrationClassification {
  const write: NamespaceMigrationWrite[] = []
  const conflicts: NamespaceMigrationConflict[] = []
  const unchanged: { rowId: string; key: string }[] = []
  const skipped: NamespaceMigrationSkip[] = [...plan.skipped]
  for (const entry of plan.entries) {
    // A row this composition does not serve (the `variant` install form keeps the model rows
    // in an agent preset, so they are mounted per session, not here) has no section to write:
    // reporting it keeps ONE unmounted row from aborting the rows that ARE mounted.
    const view = read(entry.rowId)
    if (view === undefined) {
      for (const value of entry.values) {
        skipped.push({ namespace: entry.namespace, key: value.source, reason: 'row `' + entry.rowId + '` is not served in this composition' })
      }
      continue
    }
    const user = view.user ?? {}
    const patch: Record<string, unknown> = {}
    for (const value of entry.values) {
      if (!Object.hasOwn(user, value.key)) {
        patch[value.key] = value.value
        continue
      }
      if (sameValue(user[value.key], value.value)) {
        unchanged.push({ rowId: entry.rowId, key: value.key })
        continue
      }
      conflicts.push({ rowId: entry.rowId, key: value.key, current: user[value.key], legacy: value.value })
    }
    if (Object.keys(patch).length > 0) write.push({ rowId: entry.rowId, patch })
  }
  return { write, conflicts, unchanged, skipped }
}

/**
 * Report one kept value: the stored value is the newer decision, so it wins and the legacy
 * one is named rather than dropped.
 * @param conflict - the conflict the classification found.
 * @returns the warning text.
 */
function conflictWarning(conflict: NamespaceMigrationConflict): string {
  return 'evolution-migration: row `' + conflict.rowId + '` already sets `' + conflict.key +
    '`; the stored value was kept and the legacy ' + JSON.stringify(conflict.legacy) + ' was not applied'
}

export async function applyNamespaceMigration(
  plan: NamespaceMigrationPlan,
  deps: NamespaceMigrationDeps,
): Promise<NamespaceMigrationReport> {
  // An arrow keeps the dependency's own receiver contract intact (the platform's read binds a seat).
  const decided = classifyNamespaceMigration(plan, rowId => deps.read(rowId))
  for (const conflict of decided.conflicts) deps.warn(conflictWarning(conflict))
  const written: { rowId: string; keys: string[] }[] = []
  for (const row of decided.write) {
    await deps.update(row.rowId, row.patch)
    written.push({ rowId: row.rowId, keys: Object.keys(row.patch) })
  }
  return { written, conflicts: decided.conflicts, unchanged: decided.unchanged, skipped: decided.skipped }
}
