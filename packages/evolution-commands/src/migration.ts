/**
 * G3 (caller half): find the legacy settings document and run the namespace migration.
 *
 * The platform's own one-time import knows only its private table of entries, so a family
 * section left in the document only produces a warn there — the values stay in the file the
 * import renamed. This module reads that file (the renamed one first, a not-yet-imported
 * `settings.yaml` second), plans with core's pure planner, and merges through the platform's
 * own write. Everything it touches is injected, so a spec drives it without a host.
 * @module @deepseek-ai/dsh-evolution-commands/migration
 */
import { join } from 'node:path'
import { applyNamespaceMigration, classifyNamespaceMigration, planNamespaceMigration } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike, NamespaceMigrationPlan, NamespaceMigrationReport, SettingsProviderLike } from '@deepseek-ai/dsh-evolution-core'

/**
 * The legacy document names the platform leaves behind, in read order.
 * @param home - the profile home the document sits in.
 * @returns both candidate paths, the renamed import first.
 */
export function legacySettingsPaths(home: string): readonly string[] {
  return [join(home, 'settings.yaml.imported'), join(home, 'settings.yaml')]
}

/** What one migration attempt found and did. */
export interface NamespaceMigrationOutcome {
  /** The file the plan was read from; undefined when neither name exists. */
  readonly source: string | undefined
  /** The document's plan; undefined when there was no document to read. */
  readonly plan: NamespaceMigrationPlan | undefined
  /** What the run wrote; undefined when the document carried nothing to move. */
  readonly report: NamespaceMigrationReport | undefined
}

/** Everything {@link runNamespaceMigration} needs from its caller. */
export interface NamespaceMigrationRun {
  /** The profile home the legacy document sits in. */
  readonly home: string
  /** The family IO seam, for the read. */
  readonly io: EvolutionIoLike
  /** The platform settings seat; undefined when the deployment has none. */
  readonly settings: SettingsProviderLike | undefined
  /** Where a kept value is reported (the run always reports, never silently drops). */
  readonly warn: (message: string) => void
}

/** Nothing to do: no document, or no settings seat to write through. */
const NOTHING: NamespaceMigrationOutcome = { source: undefined, plan: undefined, report: undefined }

/**
 * Read the first legacy document that exists and merge what it holds.
 *
 * The write goes through the platform's own `settings.update`, so the merge semantics, the
 * revision fence and the row's schema validation are the platform's — a row whose schema
 * refuses a key refuses the whole patch, which is why the planner refuses unknown keys
 * before this runs.
 * @param run - the home, the reader, the settings seat and the warning sink.
 * @returns the source file, its plan, and what the run did (all undefined when there was
 *   nothing to read or nowhere to write).
 */
export async function runNamespaceMigration(run: NamespaceMigrationRun): Promise<NamespaceMigrationOutcome> {
  const settings = run.settings
  if (settings === undefined) return NOTHING
  // The receiver matters (the platform's describe and write read `this`), so every call goes
  // through the object. The wrappers exist for the applier's dependency shape; the guard below
  // is what decides whether there is a seat to write through at all.
  const read = (rowId: string): { readonly user?: Record<string, unknown> | undefined } | undefined =>
    settings.describe?.({ redactSecrets: false }).find(entry => entry.ns === rowId)
  const update = async (rowId: string, patch: Readonly<Record<string, unknown>>): Promise<void> => {
    if (settings.update === undefined) return
    await settings.update(rowId, patch)
  }
  if (settings.describe === undefined || settings.update === undefined) return NOTHING
  for (const source of legacySettingsPaths(run.home)) {
    const text = await run.io.readText(source)
    if (text === null) continue
    const plan = planNamespaceMigration(text)
    if (plan.entries.length === 0) return { source, plan, report: undefined }
    const report = await applyNamespaceMigration(plan, {
      // The receiver matters: the platform's describe/write read `this`.
      read,
      update,
      warn: run.warn,
    })
    return { source, plan, report }
  }
  return NOTHING
}

/** What the legacy document still holds, and what a row already answers for. */
export interface LegacyDocumentState {
  /** The document the verdict came from. */
  readonly source: string
  /** How many legacy sections carried values a row can take. */
  readonly sections: number
  /** Keys no row carries yet, as `rowId.key` — a run would write these. */
  readonly pending: readonly string[]
  /** Keys a row already answers for (equal value, or a stored value that won). */
  readonly settled: readonly string[]
}

/** Everything {@link readLegacyDocumentState} reads: the home, the reader, the settings seat. */
export interface LegacyDocumentRead {
  /** The profile home the legacy document sits in. */
  readonly home: string
  /** The family IO seam, for the read. */
  readonly io: EvolutionIoLike
  /** The platform settings seat; undefined when the deployment has none. */
  readonly settings: SettingsProviderLike | undefined
}

/**
 * Read the legacy document and report what is still unmigrated.
 *
 * Read-only by construction: the answer comes from the pure classifier, never from the
 * applier, so a doctor run cannot write. `runNamespaceMigration` and this read the SAME
 * decision, which is what keeps the report and the next run's outcome from disagreeing.
 * @param run - the home, the reader, the settings seat.
 * @returns the state, or undefined when there is no legacy document or no settings seat.
 */
export async function readLegacyDocumentState(run: LegacyDocumentRead): Promise<LegacyDocumentState | undefined> {
  const settings = run.settings
  if (settings?.describe === undefined) return undefined
  for (const source of legacySettingsPaths(run.home)) {
    const text = await run.io.readText(source)
    if (text === null) continue
    const plan = planNamespaceMigration(text)
    // The receiver matters here too: `describe` reads `this`.
    const read = (rowId: string): { readonly user?: Record<string, unknown> | undefined } | undefined =>
      settings.describe?.({ redactSecrets: false }).find(entry => entry.ns === rowId)
    const decided = classifyNamespaceMigration(plan, read)
    return {
      source,
      sections: plan.entries.length,
      pending: decided.write.flatMap(row => Object.keys(row.patch).map(key => row.rowId + '.' + key)),
      settled: [
        ...decided.unchanged.map(entry => entry.rowId + '.' + entry.key),
        ...decided.conflicts.map(entry => entry.rowId + '.' + entry.key),
      ],
    }
  }
  return undefined
}

/** The context members the migration reads, structurally, so a spec needs no host. */
export interface MigrationHost {
  /** The service store (`settings`, `profileContext`, `evolutionIo`). */
  get(name: string): unknown
  readonly logger: { warn(message: string): void }
}

/** Why an attempt could not run: a missing prerequisite, named for the caller's message. */
export type NamespaceMigrationProblem = 'settings' | 'home' | 'io'

/** One attempt: either an outcome, or the prerequisite that was absent. */
export type NamespaceMigrationAttempt =
  | { readonly ok: true; readonly outcome: NamespaceMigrationOutcome }
  | { readonly ok: false; readonly problem: NamespaceMigrationProblem }

/**
 * Run the migration from a plugin context: probe the settings seat, the profile home and the
 * IO seam, then delegate to {@link runNamespaceMigration}.
 *
 * The command reports `problem` as its own error text; a boot-time caller skips instead — the
 * point of naming the missing prerequisite rather than throwing is that both readers can act.
 * @param host - the context (services + logger).
 * @returns the outcome, or the prerequisite that is absent.
 */
export async function migrateFromContext(host: MigrationHost): Promise<NamespaceMigrationAttempt> {
  const settings = host.get('settings') as SettingsProviderLike | undefined
  if (settings?.update === undefined || settings.describe === undefined) return { ok: false, problem: 'settings' }
  const profile = host.get('profileContext') as { home?: unknown } | undefined
  const home = typeof profile?.home === 'string' ? profile.home : ''
  if (home === '') return { ok: false, problem: 'home' }
  const io = (host.get('evolutionIo') as { provider?(): EvolutionIoLike } | undefined)?.provider?.()
  if (io === undefined) return { ok: false, problem: 'io' }
  const outcome = await runNamespaceMigration({
    home,
    io,
    settings,
    warn: (message) => { host.logger.warn(message) },
  })
  return { ok: true, outcome }
}

/**
 * Render one outcome for the command surface.
 * @param outcome - the run's result.
 * @returns the report text (Chinese copy, the family's user-facing language).
 */
export function renderNamespaceMigration(outcome: NamespaceMigrationOutcome): string {
  if (outcome.source === undefined) {
    return '迁移：没有找到旧设置文档（settings.yaml.imported / settings.yaml），无需迁移。'
  }
  const report = outcome.report
  if (report === undefined) return '迁移：' + outcome.source + ' 里没有家族的旧分区，无需迁移。'
  const rows = report.written.map(row => `${row.rowId}:${row.keys.join('/')}`).join('；')
  const kept = report.conflicts.map(conflict => `${conflict.rowId}.${conflict.key}`).join('、')
  const skipped = report.skipped.map(skip => `${skip.namespace}.${skip.key}`).join('、')
  return [
    `迁移源：${outcome.source}`,
    `写入：${report.written.length} 行${rows === '' ? '' : `（${rows}）`}`,
    `已一致：${report.unchanged.length} 个键（值相同，未写入）`,
    `保留现值：${report.conflicts.length} 个键${kept === '' ? '' : `（${kept}）`}`,
    `未迁移：${report.skipped.length} 个键${skipped === '' ? '' : `（${skipped}）`}`,
  ].join('\n')
}
