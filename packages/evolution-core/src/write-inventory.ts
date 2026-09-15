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
export type WriteSerialization = 'transact' | 'write-lock' | 'instance-claim'

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

/** Parse + validate the table. A malformed table throws at import: a table the
 * gate cannot read must never degrade into "no declared write sites". */
function parseSites(raw: unknown): PersistedWriteSite[] {
  if (!Array.isArray(raw)) throw new Error('evolution-core: persisted-write-inventory.json must be an array of sites')
  const sites: PersistedWriteSite[] = []
  for (const [index, entry] of raw.entries()) {
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
  return sites
}

/** Instance keys held by writer services — the single source shared by the
 * claim site and the inventory row that declares it (rule N20 checks the row's
 * `instance` names one of these). */
export const INSTANCE_KEYS = {
  /** The per-home curator: report writing + the retention sweep. */
  curator: 'evolution-curator',
} as const

let cachedSites: PersistedWriteSite[] | undefined

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
  cachedSites = parseSites(JSON.parse(raw) as unknown)
  return cachedSites
}

/** Sites serialized by the per-home instance claim, with their instance keys. */
export function instanceClaimedWriteSites(): readonly (PersistedWriteSite & { readonly instance: string })[] {
  return persistedWriteSites().filter(
    (site): site is PersistedWriteSite & { readonly instance: string } => site.serializedBy === 'instance-claim',
  )
}

/** One declared site by id. An undeclared id throws — a stale caller must fail
 * loud rather than read "nothing is declared". */
export function persistedWriteSite(id: string): PersistedWriteSite {
  const site = persistedWriteSites().find(candidate => candidate.id === id)
  if (site === undefined) throw new Error(`evolution-core: no persisted write site "${id}" in persisted-write-inventory.json`)
  return site
}
