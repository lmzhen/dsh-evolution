/**
 * B3 / G4 (0.3.78): the persisted-write inventory — WHICH file the family
 * writes, WHO writes it, and WHAT keeps two writers apart.
 *
 * The table lives in `persisted-write-inventory.json` at the package root so
 * the TypeScript side, the architecture gate (`verify-arch-guards` rule N20)
 * and the regression specs read ONE file (the row-overrides.json pattern).
 *
 * "What keeps two writers apart" has exactly three answers in this family:
 * - `transact`       — the IO backend's cross-process write lock (transactIo);
 * - `write-lock`     — the per-target `<path>.lock` protocol of the skill tree;
 * - `instance-claim` — the per-home single-instance claim (instance-scope.ts),
 *   for a writer whose sweeps cannot be expressed as one locked file.
 * A site that answers with NONE of them is the "two instances, one file" class:
 * a per-instance serial queue looks like serialization and is not.
 * @module @deepseek-ai/dsh-evolution-core/src/write-inventory
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** How concurrent writers of one site are kept apart. */
type WriteSerialization = 'transact' | 'write-lock' | 'instance-claim'

/** One declared persisted write site. */
export interface PersistedWriteSite {
  /** Stable id; referenced by the gate's failure text and by the specs. */
  readonly id: string
  /** The path(s) written, with the roots the family resolves at runtime. */
  readonly path: string
  /** Repo-relative module that owns the write. */
  readonly writer: string
  /** The serialization the writer implements (see the module docblock). */
  readonly serializedBy: WriteSerialization
  /** Literal that must appear in `writer` — the gate's proof of the claim. */
  readonly marker: string
  /** The instance key the writer holds when `serializedBy` is instance-claim. */
  readonly instance?: string
  /** Module-scope state keys (N12 registry keys) this writer keeps, if any. */
  readonly state: readonly string[]
  /** One line on what the file holds; the inventory reads as a whole. */
  readonly note: string
}

const SITES_URL = new URL('../persisted-write-inventory.json', import.meta.url)
const SERIALIZATIONS: readonly string[] = ['transact', 'write-lock', 'instance-claim']

/** One root symbol of the inventory's own legend. `segments` is the path tail the symbol appends to
 * its base (empty for the home itself), and `basedOn` names the symbol it extends. The gate
 * `verify-write-inventory.mjs` checks those segments against the resolver's SOURCE, so the legend
 * cannot drift from the code that resolves it. */
export interface WritePathSymbol {
  /** Name of the core resolver that produces this root (or 'caller' for a caller-supplied path). */
  readonly resolver: string
  /** Path segments appended to the base root, in order. */
  readonly segments: readonly string[]
  /** The symbol this one extends, when it is not rooted at the DSH home itself. */
  readonly basedOn?: string
}

/** The table's shape: a symbol legend plus the declared sites. */
interface WriteInventoryTable {
  symbols: Record<string, WritePathSymbol>
  readonly sites: readonly PersistedWriteSite[]
}

/** Parse + validate the table. A malformed table throws at import: a table the
 * gate cannot read must never degrade into "no declared write sites". */
function parseTable(raw: unknown): WriteInventoryTable {
  // The input is UNKNOWN JSON, so each narrowing below is a real runtime check (and each later check
  // is written so the previous one already excluded its negation — the linter rejects tautologies).
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('evolution-core: persisted-write-inventory.json must be an object with { symbols, sites }')
  }
  const table = raw as { symbols?: unknown; sites?: unknown }
  // typeof null === 'object', so the null test stays — and it comes FIRST: after `typeof !== 'object'`
  // TypeScript has already dropped null, and the linter is right to call that test a tautology.
  if (table.symbols === null || typeof table.symbols !== 'object' || Array.isArray(table.symbols)) {
    throw new Error('evolution-core: persisted-write-inventory.json needs a symbols legend (the roots every path is written against)')
  }
  for (const [symbol, entry] of Object.entries(table.symbols)) {
    const problems: string[] = []
    if (!symbol.startsWith('<') || !symbol.endsWith('>')) problems.push('symbol name (must be <name>)')
    if (entry === null || typeof entry !== 'object') problems.push('entry')
    else {
      const symbolEntry = entry as { resolver?: unknown; segments?: unknown }
      if (typeof symbolEntry.resolver !== 'string' || symbolEntry.resolver === '') problems.push('resolver')
      if (symbolEntry.segments !== undefined
        && (!Array.isArray(symbolEntry.segments) || symbolEntry.segments.some(segment => typeof segment !== 'string'))) problems.push('segments')
    }
    if (problems.length > 0) {
      throw new Error(`evolution-core: persisted-write-inventory.json symbol ${symbol} is malformed (missing/invalid: ${problems.join(', ')})`)
    }
  }
  if (!Array.isArray(table.sites)) throw new Error('evolution-core: persisted-write-inventory.json needs a sites array')
  const sites: PersistedWriteSite[] = []
  for (const [index, entry] of table.sites.entries()) {
    const site = entry as Partial<PersistedWriteSite>
    const problems: string[] = []
    if (typeof site.id !== 'string' || site.id === '') problems.push('id')
    if (typeof site.path !== 'string' || site.path === '') problems.push('path')
    if (typeof site.writer !== 'string' || site.writer === '') problems.push('writer')
    if (typeof site.marker !== 'string' || site.marker === '') problems.push('marker')
    if (typeof site.serializedBy !== 'string' || !SERIALIZATIONS.includes(site.serializedBy)) problems.push('serializedBy')
    if (site.serializedBy === 'instance-claim' && typeof site.instance !== 'string') problems.push('instance')
    if (!Array.isArray(site.state)) problems.push('state')
    if (problems.length > 0) {
      throw new Error(`evolution-core: persisted-write-inventory.json entry ${index} is malformed (missing/invalid: ${problems.join(', ')})`)
    }
    sites.push({
      id: site.id as string,
      path: site.path as string,
      writer: site.writer as string,
      serializedBy: site.serializedBy as WriteSerialization,
      marker: site.marker as string,
      ...(typeof site.instance === 'string' ? { instance: site.instance } : {}),
      state: site.state as readonly string[],
      note: typeof site.note === 'string' ? site.note : '',
    })
  }
  const ids = new Set(sites.map(site => site.id))
  if (ids.size !== sites.length) throw new Error('evolution-core: persisted-write-inventory.json declares duplicate site ids')
  // Every entry was validated above, so the unknown JSON is now the table's own shape.
  return { symbols: table.symbols as Record<string, WritePathSymbol>, sites }
}

/** Instance keys held by writer services — the single source shared by the
 * claim site and the inventory row that declares it (rule N20 checks the row's
 * `instance` names one of these). */
export const INSTANCE_KEYS = {
  /** The per-home curator: report writing + the retention sweep. */
  curator: 'evolution-curator',
} as const

// Both caches are READONLY on purpose: the table's own shape is readonly, and copying it into a
// mutable array would be a second source of truth for the same rows.
let cachedSites: readonly PersistedWriteSite[] | undefined
let cachedSymbols: Readonly<Record<string, WritePathSymbol>> | undefined

/**
 * The declared persisted write sites, in file order.
 *
 * v43 audit (S2-3 / P1-10): this used to be a module-scope readFileSync plus
 * parse, so an unshipped asset threw AT IMPORT — one absent file took the whole
 * family's load down (0.3.79 shipped a tarball without this asset and every
 * package failed to load). The read is lazy now: importing the package never
 * fails on this asset, while the first caller still gets a loud, descriptive
 * failure instead of an empty table ("no declared write sites" would silently
 * disable rule N20).
 * @internal S2.4 (PLAN 2026-09-16): no production caller — the arch guard
 * reads the JSON asset directly; the tests are the only in-tree consumers.
 * @returns the sites, in file order.
 */
export function persistedWriteSites(): readonly PersistedWriteSite[] {
  if (cachedSites !== undefined) return cachedSites
  let raw: string
  try {
    raw = readFileSync(fileURLToPath(SITES_URL), 'utf8')
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    throw new Error(`evolution-core: persisted-write-inventory.json is unreadable (${cause}) — the package asset is missing or was not shipped; the write-inventory rules cannot be evaluated without it`)
  }
  const table = parseTable(JSON.parse(raw) as unknown)
  cachedSites = table.sites
  cachedSymbols = table.symbols
  return table.sites
}

/** The inventory's symbol legend — the roots every declared path is written against, with the
 * segments the gate checks against the resolver's source.
 * @internal no production caller — the gates read the JSON asset directly. */
export function writePathSymbols(): Readonly<Record<string, WritePathSymbol>> {
  persistedWriteSites()
  return cachedSymbols ?? {}
}

/** Sites serialized by the per-home instance claim, with their instance keys.
 * @internal S2.4 (PLAN 2026-09-16): no production caller — the arch guard
 * reads the JSON asset directly; the tests are the only in-tree consumers. */
export function instanceClaimedWriteSites(): readonly (PersistedWriteSite & { readonly instance: string })[] {
  return persistedWriteSites().filter(
    (site): site is PersistedWriteSite & { readonly instance: string } => site.serializedBy === 'instance-claim',
  )
}

/** One declared site by id. An undeclared id throws — a stale caller must fail
 * loud rather than read "nothing is declared".
 * @internal S2.4 (PLAN 2026-09-16): no production caller — the arch guard
 * reads the JSON asset directly; the tests are the only in-tree consumers. */
export function persistedWriteSite(id: string): PersistedWriteSite {
  const site = persistedWriteSites().find(candidate => candidate.id === id)
  if (site === undefined) throw new Error(`evolution-core: no persisted write site "${id}" in persisted-write-inventory.json`)
  return site
}
