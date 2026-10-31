import MiniSearch from 'minisearch'
import { searchIndexKeyOf, type SkillIndexRow } from './identity.ts'

/** Tokenizer version; changing the algorithm requires rebuilding indexes. */
export const SKILL_SEARCH_TOKENIZER_VERSION = 'cjk-bigram-v1'

/** Fields indexed by skill search; no body/path. */
export const SKILL_SEARCH_FIELDS = ['name', 'description', 'whenToUse'] as const

/** Index schema version; bump when indexed fields/options change. */
export const SKILL_SEARCH_INDEX_SCHEMA_VERSION = 'skill-search-v1'

/** One lexical search request. */
export interface SkillSearchQuery {
  readonly query: string
  readonly limit?: number | undefined
}

/** One lexical search hit; the model loads the body separately. */
export interface SkillSearchHit {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string | undefined
  readonly matchedBy?: string | undefined
}

/** Independent search read service. */
export interface SkillSearchResponse {
  readonly results: readonly SkillSearchHit[]
  readonly truncated: boolean
  readonly fallback?: boolean | undefined
  readonly stale?: boolean | undefined
  readonly degraded?: boolean | undefined
  readonly hint?: string | undefined
}

export interface SkillSearch {
  search(query: SkillSearchQuery, options?: { readonly allowedSkillKeys?: ReadonlySet<string> | undefined }): Promise<SkillSearchResponse>
}

/** One search document; id is the stable skillKey. */
interface SearchDocument {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly whenToUse: string
}

const CJK = String.raw`[[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}]&&[\p{L}\p{M}\p{N}]]`
const RUN = new RegExp(String.raw`${CJK}+|[[\p{L}\p{M}\p{N}]--${CJK}]+`, 'gv')
const CJK_START = new RegExp(String.raw`^${CJK}`, 'v')

/**
 * Split NFKC text into CJK overlapping bigrams plus tail, and ASCII/other runs.
 * Parity source: plugin-market/src/search.ts searchTerms.
 * @param text - indexed or queried text.
 * @returns terms in text order; callers lowercase.
 */
export function searchTerms(text: string): string[] {
  return [...text.normalize('NFKC').matchAll(RUN)].flatMap(([run]) => {
    if (!CJK_START.test(run)) return [run]
    const chars = Array.from(run)
    return [...chars.slice(1).map((char, position) => chars[position] + char), chars.at(-1) as string]
  })
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 3
  return Math.min(20, Math.max(1, Math.trunc(limit)))
}

function build(rows: readonly SkillIndexRow[]): MiniSearch<SearchDocument> {
  const engine = new MiniSearch<SearchDocument>({
    fields: [...SKILL_SEARCH_FIELDS],
    storeFields: [...SKILL_SEARCH_FIELDS],
    tokenize: searchTerms,
    processTerm: term => term.toLowerCase(),
    searchOptions: {
      boost: { name: 3, whenToUse: 2 },
      prefix: true,
      combineWith: 'AND',
      fuzzy: term => term.length >= 4 && !CJK_START.test(term) ? 0.2 : false,
      maxFuzzy: 2,
    },
  })
  const seen = new Set<string>()
  const documents: SearchDocument[] = []
  for (const row of rows) {
    if (!row.modelInvocable || row.protected || row.pinned || seen.has(row.skillKey)) continue
    seen.add(row.skillKey)
    documents.push({ id: row.skillKey, name: row.name, description: row.description, whenToUse: row.whenToUse ?? '' })
  }
  engine.addAll(documents)
  return engine
}

/** Per-view MiniSearch index; no global engine and no projection-only filtering. */
export class SkillSearchIndex implements SkillSearch {
  private engine: MiniSearch<SearchDocument>
  private staleState = false

  readonly viewKey: string
  private constructor(viewKey: string, engine: MiniSearch<SearchDocument>) {
    this.viewKey = viewKey
    this.engine = engine
  }

  /** @returns an index over every modelInvocable row in this view. */
  static fromRows(viewKey: string, rows: readonly SkillIndexRow[]): SkillSearchIndex {
    return new SkillSearchIndex(viewKey, build(rows))
  }

  /** Mark the current index stale before a rebuild finishes. */
  markStale(): void { this.staleState = true }

  /** Rebuild from this view's full rows; a failed rebuild keeps the old engine stale. */
  async rebuild(rows: readonly SkillIndexRow[]): Promise<boolean> {
    this.staleState = true
    try {
      this.engine = build(rows)
      this.staleState = false
      return true
    } catch {
      return false
    }
  }

  /** @returns hits, truncation, and whether the index is stale. */
  async search(query: SkillSearchQuery, options?: { readonly allowedSkillKeys?: ReadonlySet<string> | undefined }): Promise<SkillSearchResponse> {
    const limit = clampLimit(query.limit)
    const terms = searchTerms(query.query)
    if (terms.length === 0) return { results: [], truncated: false, stale: this.staleState }
    let fallback = false
    let hits = this.engine.search(query.query, { combineWith: 'AND' })
    if (hits.length === 0 && terms.length > 1) {
      const relaxed = this.engine.search(query.query, { combineWith: 'OR' })
      fallback = relaxed.length > 0
      hits = relaxed
    }
    const allowed = options?.allowedSkillKeys
    const filtered = allowed === undefined ? hits : hits.filter(hit => allowed.has(String(hit.id)))
    const results: SkillSearchHit[] = filtered.slice(0, limit).map(hit => {
      const fields = new Set(Object.values(hit.match).flat())
      return {
        name: String(hit.name),
        description: String(hit.description),
        ...hit.whenToUse === undefined || hit.whenToUse === '' ? {} : { whenToUse: String(hit.whenToUse) },
        matchedBy: fields.has('name') ? 'name' : fields.has('whenToUse') ? 'whenToUse' : 'description',
      }
    })
    return { results, truncated: filtered.length > limit, ...fallback ? { fallback: true } : {}, stale: this.staleState }
  }
}

/** Identity inputs for one per-view search index. */
export interface SearchIndexCacheKey {
  readonly viewKey: string
  readonly viewCatalogDigest: string
  readonly policyDigest: string
  readonly discoveryMode: string
}

interface CacheEntry {
  readonly key: string
  readonly viewKey: string
  readonly index: SkillSearchIndex
}

/** Per-view cache keyed by searchIndexKey; never shares one engine across views. */
export class SkillSearchCache {
  private readonly entries = new Map<string, CacheEntry>()

  /**
   * Get or build one view index. A failed rebuild retains the previous engine
   * and marks it stale; no previous engine means undefined.
   * @param key - identity inputs for searchIndexKey.
   * @param rows - current full rows for the view.
   * @returns index plus stale state, or undefined when no index is available.
   */
  async get(key: SearchIndexCacheKey, rows: readonly SkillIndexRow[]): Promise<{ index: SkillSearchIndex; stale: boolean } | undefined> {
    const cacheKey = searchIndexKeyOf({
      viewKey: key.viewKey,
      viewCatalogDigest: key.viewCatalogDigest,
      policyDigest: key.policyDigest,
      tokenizerVersion: SKILL_SEARCH_TOKENIZER_VERSION,
      indexSchemaVersion: SKILL_SEARCH_INDEX_SCHEMA_VERSION,
      discoveryMode: key.discoveryMode,
    })
    const existing = this.entries.get(cacheKey)
    if (existing !== undefined) return { index: existing.index, stale: false }
    try {
      const index = SkillSearchIndex.fromRows(key.viewKey, rows)
      this.entries.set(cacheKey, { key: cacheKey, viewKey: key.viewKey, index })
      return { index, stale: false }
    } catch {
      const old = [...this.entries.values()].find(entry => entry.viewKey === key.viewKey)
      if (old === undefined) return undefined
      old.index.markStale()
      return { index: old.index, stale: true }
    }
  }

  /** Drop every index for one view. */
  invalidate(viewKey: string): void {
    for (const [cacheKey, entry] of this.entries) if (entry.viewKey === viewKey) this.entries.delete(cacheKey)
  }

  /** Drop every cached view index. */
  clear(): void { this.entries.clear() }
}
