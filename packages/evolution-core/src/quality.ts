/**
 * Quality scoring and near-duplicate detection for the curated skill library.
 *
 * Pure functions over data inputs so the scoring policy is unit-testable and
 * the same math feeds the usage sidecar, the `skill_manage review` surface and
 * the learning graph. Weights follow the Hermes/hermes-claw six-factor model;
 * mutation maturity is a documented DSH approximation (single per-month patch
 * trend ratio replaces the claw timestamp-trend formula, since DSH usage
 * records only carry the last patched timestamp).
 *
 * Batch C (2026-09-27): the similarity half of this module is now TWO NAMED
 * QUESTIONS plus a declared projection — {@link identity} ("is it the same
 * text?") and {@link affinity} ("how much vocabulary do these two share?") asked
 * over {@link projectionText}. Callers name the question and the projection
 * instead of growing a fourth unnamed ruler (design §3C / §1 I2).
 * @module @deepseek-ai/dsh-evolution-core
 */

import { createHash } from 'node:crypto'
import type { UsageMap } from './usage.ts'
import { latestActivityAt } from './usage.ts'

export interface QualityFactors {
  /** 0.25 — skill LOADS per day of age (view_count + use_count), capped at 1. */
  usageFrequency: number
  /** 0.20 — 1 − patch/load (zero loads = stable). */
  stability: number
  /** 0.20 — 1 under 30 idle days, linear decay to 0 at 180. */
  recency: number
  /** 0.10 — in-degree / 3 (graph references), capped at 1. */
  references: number
  /** 0.20 — patch cadence maturity (DSH approximation of the trend formula). */
  mutationMaturity: number
  /** 0.05 — non-empty support subdirectories × 0.175, capped at 1. */
  richness: number
}

export interface QualityScore {
  score: number
  factors: QualityFactors
  warn: boolean
}

export const QUALITY_WEIGHTS = {
  usageFrequency: 0.25,
  stability: 0.20,
  recency: 0.20,
  references: 0.10,
  mutationMaturity: 0.20,
  richness: 0.05,
} as const

/** Score below which a skill is flagged for review. */
export const LOW_QUALITY_THRESHOLD = 0.3

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function daysBetween(from: string, now: Date): number {
  // A2-9 (v18): an unparseable timestamp must not poison the score with NaN.
  const t = Date.parse(from)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (now.getTime() - t) / 86_400_000)
}

export function computeQualityScores(input: {
  usage: UsageMap
  referenceCounts?: ReadonlyMap<string, number>
  supportDirs?: ReadonlyMap<string, number>
  now?: Date
}): Map<string, QualityScore> {
  const now = input.now ?? new Date()
  const scores = new Map<string, QualityScore>()
  for (const [name, record] of input.usage) {
    const ageDays = Math.max(1, daysBetween(record.created_at, now))
    const idleDays = daysBetween(latestActivityAt(record) ?? record.created_at, now)
    const patchCount = record.patch_count
    // E-2 / G-1 (v18): a skill is "used" when it is LOADED. The in-tree
    // producer is the platform `skill` tool's `view` bump (skill-usage
    // READ_SKILL_TOOL_KIND); `use_count` has no in-tree producer and stays an
    // EXTERNAL host signal. Summing both makes these two factors real today
    // while still counting a host that writes `use` — no durable-format change
    // and no silent refactor of the published field.
    const loadCount = record.use_count + record.view_count
    const usageFrequency = clamp01(loadCount / ageDays)
    const stability = loadCount === 0 ? 1 : clamp01(1 - patchCount / loadCount)
    const recency = idleDays < 30 ? 1 : clamp01(1 - (idleDays - 30) / 150)
    const references = clamp01((input.referenceCounts?.get(name) ?? 0) / 3)
    const mutationMaturity = patchCount === 0 ? 0.3 : patchCount === 1 ? 0.4 : clamp01((patchCount - 1) / Math.max(1, ageDays / 30))
    const richness = clamp01((input.supportDirs?.get(name) ?? 0) * 0.175)

    const factors: QualityFactors = { usageFrequency, stability, recency, references, mutationMaturity, richness }
    const score = usageFrequency * QUALITY_WEIGHTS.usageFrequency
      + stability * QUALITY_WEIGHTS.stability
      + recency * QUALITY_WEIGHTS.recency
      + references * QUALITY_WEIGHTS.references
      + mutationMaturity * QUALITY_WEIGHTS.mutationMaturity
      + richness * QUALITY_WEIGHTS.richness
    scores.set(name, { score, factors, warn: score < LOW_QUALITY_THRESHOLD })
  }
  return scores
}

function normalize(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------------- *
 * Similarity: two NAMED questions, and the projection a caller declares.
 *
 * Batch C (2026-09-27, design §3C) — the module used to carry three unnamed
 * rulers (a normalized hash, a token Jaccard, a first-word name index) whose
 * questions overlapped without saying so. The questions are now named, and a
 * caller that wants a comparison must name the one it is asking:
 *
 *   1. {@link identity}  — "is this the SAME TEXT?" (normalized-content hash)
 *   2. {@link affinity}  — "how much VOCABULARY do these two share?" (Jaccard
 *                          over two {@link vocabulary} sets)
 *
 * {@link computePrefixClusters} stays what it always was — a name-side
 * STRUCTURAL index (which names share a first word), not a similarity score.
 * What a caller declares instead of inventing a fourth ruler is the PROJECTION
 * ({@link projectionText}): `body` = the whole SKILL.md, `summary` = name +
 * description. Adding a projection is one entry in that table, and the two
 * callers stop disagreeing about what they compared (design §6.4).
 * ------------------------------------------------------------------------- */

/** Named similarity question 1 — "is it the same text?" — as a normalized
 * content hash: case- and whitespace-insensitive, so two texts that differ only
 * in formatting are the SAME text here. Invariant under which projection the
 * caller read the text from.
 *
 * C-26 (v10 audit): NOT named `contentHash` — mutations.ts exports a
 * contentHash of RAW bytes, this one hashes the NORMALIZED text for dedup
 * grouping. Same helper as that rename, now a named question. */
export function identity(text: string): string {
  return createHash('sha256').update(normalize(text)).digest('hex')
}

/** Which text a similarity question is asked about. Declared by the caller. */
export type SimilarityProjection = 'body' | 'summary'

/** The one input shape both projections read from: a caller passes what it has. */
export interface SimilarityInput {
  /** The whole SKILL.md — the `body` projection. */
  content?: string
  /** The skill name — half of the `summary` projection. */
  name?: string
  /** The frontmatter description — half of the `summary` projection. */
  description?: string
}

/**
 * The declared projection: WHICH text a comparison weighs.
 *
 * `body` is the library-wide scan's projection (whole SKILL.md, costs a body
 * read). `summary` is name + description in one string — the projection a
 * listing already publishes (`SkillSummary` carries both fields, and a body is
 * attached only when the caller asks for it), which is what makes the
 * create-time duplicate hint cost no extra read.
 */
export function projectionText(projection: SimilarityProjection, input: SimilarityInput): string {
  switch (projection) {
    case 'body': return input.content ?? ''
    case 'summary': return `${input.name ?? ''} ${input.description ?? ''}`
  }
}

/** The comparable vocabulary of one text: lowercase alphanumeric runs, plus
 * whole CJK runs (a Chinese description tokenizes by punctuation, not by word —
 * deliberately: the ruler is one home, and a real tokenizer is a different
 * question than "do these two share vocabulary?"). */
export function vocabulary(text: string): ReadonlySet<string> {
  return new Set(normalize(text).split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean))
}

/** Named similarity question 2 — "how much vocabulary do these two share?" —
 * Jaccard over two {@link vocabulary} sets, 0 (nothing in common, or either side
 * empty) to 1 (identical vocabulary). Set-based on purpose: the bulk scan
 * memoizes each name's set once and only the comparisons are budgeted. */
export function affinity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

/** The `affinity` level at which two bodies are treated as the same skill
 * (design §3C: the default is unchanged at 0.95 — it is now a NAME, because the
 * docblock below has linked it since PLAN-R2 while the code carried a bare
 * literal). Callers may still pass their own level. */
export const DEDUP_SIMILARITY_THRESHOLD = 0.95

/** PLAN-R2 P2-8 (2026-09-16): default cap on two-name comparisons in
 * {@link computeDedupGroups}. A 2000-skill library is ~2M pairs; the old
 * unbounded two-two Jaccard ran seconds to tens of seconds per
 * review/`dedup_group` probe. 250k comparisons bounds that to well under a
 * second while staying far above every real library's pair count. Only
 * pairwise comparisons are budgeted — materializing a name's token set
 * (memoized, once per name) and the exact-hash pre-union phase are not. */
export const DEDUP_MAX_PAIR_COMPARISONS = 250_000

/** PLAN-R2 P2-8 (2026-09-16): result of the near-duplicate scan. `truncated`
 * reports that the pairwise scan stopped at the comparison budget: groups
 * already found are valid, but pairs beyond the budget were never examined. */
export interface DedupScanResult {
  groups: string[][]
  truncated: boolean
}

/**
 * Two-phase near-duplicate clustering: exact normalized-hash groups first,
 * then token-Jaccard edges at {@link DEDUP_SIMILARITY_THRESHOLD} with a token
 * ratio guard, union-find across the whole set.
 *
 * PLAN-R2 P2-8 (2026-09-16): each name's token set is materialized once
 * (memoized map), each pair takes an O(1) size-ratio short-circuit before the
 * intersection, and the pairwise loop is bounded by
 * `maxPairComparisons` (default {@link DEDUP_MAX_PAIR_COMPARISONS}); hitting
 * the budget stops the scan and `truncated: true` says so. Small libraries
 * (below the budget) behave exactly as the unbounded scan did.
 */
export function computeDedupGroups(input: {
  contents: ReadonlyMap<string, string>
  threshold?: number
  /** Pair-comparison budget (PLAN-R2 P2-8). Defaults to
   * {@link DEDUP_MAX_PAIR_COMPARISONS}; a smaller value truncates earlier. */
  maxPairComparisons?: number
}): DedupScanResult {
  const threshold = input.threshold ?? DEDUP_SIMILARITY_THRESHOLD
  const maxPairComparisons = input.maxPairComparisons ?? DEDUP_MAX_PAIR_COMPARISONS
  const names = [...input.contents.keys()]
  const hashes = new Map<string, string[]>()
  for (const name of names) {
    // Question 1 over the declared projection: the body is what this scan weighs
    // (it was handed bodies by its caller — see the tool path's exclusion notes).
    const hash = identity(projectionText('body', { content: input.contents.get(name) ?? '' }))
    const bucket = hashes.get(hash)
    if (bucket) bucket.push(name)
    else hashes.set(hash, [name])
  }
  // Union-find over names; exact-hash peers are pre-united.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    const root = parent.get(x) ?? x
    if (root !== x) parent.set(x, find(root))
    return parent.get(x) ?? x
  }
  const union = (a: string, b: string): void => {
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(rb, ra)
  }
  for (const [, bucketNames] of hashes) {
    const first = bucketNames[0]
    if (first === undefined || bucketNames.length === 1) continue
    for (let index = 1; index < bucketNames.length; index += 1) {
      const peer = bucketNames[index]
      if (peer) union(first, peer)
    }
  }
  const tokens = new Map<string, ReadonlySet<string>>()
  const tokenSet = (name: string): ReadonlySet<string> => {
    let set = tokens.get(name)
    if (!set) {
      set = vocabulary(projectionText('body', { content: input.contents.get(name) ?? '' }))
      tokens.set(name, set)
    }
    return set
  }
  // PLAN-R2 P2-8: the memoized tokenSet materializes each name's set at most
  // once; only the two-name comparisons below count against the budget.
  let compared = 0
  let truncated = false
  for (let index = 0; index < names.length && !truncated; index += 1) {
    const a = names[index]
    if (a === undefined) continue
    for (let other = index + 1; other < names.length; other += 1) {
      const b = names[other]
      if (b === undefined) continue
      if (compared >= maxPairComparisons) {
        truncated = true
        break
      }
      compared += 1
      const [ta, tb] = [tokenSet(a), tokenSet(b)]
      if (Math.max(ta.size, tb.size) / Math.max(1, Math.min(ta.size, tb.size)) > 5) continue
      if (affinity(ta, tb) >= threshold) union(a, b)
    }
  }
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const root = find(name)
    const group = groups.get(root)
    if (group) group.push(name)
    else groups.set(root, [name])
  }
  return { groups: [...groups.values()].filter(group => group.length > 1), truncated }
}

/**
 * The create-time near-duplicate question (batch C, design §3C-2): WHICH
 * existing skills is this authoring candidate about to near-copy?
 *
 * It is the SAME {@link affinity} question as the library-wide scan, asked over
 * the `summary` projection — the one a listing already publishes
 * (`SkillSummary` carries `name` and `description`; nothing here can see a
 * body, which is the point: a create must not pay a whole-tree body read to warn
 * about a copy). Deliberately hint-only: the caller writes regardless, and the
 * matches are news, not a gate (G4 — the create-time foreground behavior is
 * unchanged).
 *
 * The default level is far below the scan's {@link DEDUP_SIMILARITY_THRESHOLD}
 * because the projection is thinner: a name plus one sentence shares far fewer
 * tokens than two bodies, and a hint that fires on every new skill is noise.
 * Exact same-name candidates are skipped — the library's own create refuses
 * those, and this line must not repeat that refusal.
 */
export const SUMMARY_DUPLICATE_HINT_THRESHOLD = 0.5

/** The fields {@link nearDuplicateSummaries} weighs — a structural subset of
 * `SkillSummary`, so a listing feeds it without a conversion. */
export interface SummaryCandidate {
  name: string
  description?: string
}

export interface SummaryMatch {
  name: string
  /** The `summary`-projection {@link affinity} in 0..1. */
  score: number
}

export function nearDuplicateSummaries(input: {
  candidate: SummaryCandidate
  existing: ReadonlyArray<SummaryCandidate>
  /** Level at which a match is reported. Defaults to
   * {@link SUMMARY_DUPLICATE_HINT_THRESHOLD}. */
  threshold?: number
  /** Cap on returned matches, closest first. Defaults to 3. */
  limit?: number
}): SummaryMatch[] {
  const threshold = input.threshold ?? SUMMARY_DUPLICATE_HINT_THRESHOLD
  const limit = input.limit ?? 3
  const candidateTokens = vocabulary(projectionText('summary', input.candidate))
  const matches: SummaryMatch[] = []
  for (const existing of input.existing) {
    if (existing.name === input.candidate.name) continue
    const score = affinity(candidateTokens, vocabulary(projectionText('summary', existing)))
    if (score >= threshold) matches.push({ name: existing.name, score })
  }
  return matches
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * Prefix-cluster index over a name set (rc.67 merge heuristic, input side):
 * the curator prompt asks the model to identify "prefix clusters — skills
 * sharing a first word or domain keyword"; the deterministic index supplies
 * stable ground truth instead of letting the model infer clusters from the
 * raw list. Key = first alphanumeric run of the lowercased name; groups with
 * at least two members, largest first then alphabetical. Orientation-only:
 * nomination authority stays with the LLM and the candidate-pool gates.
 */
export function computePrefixClusters(names: ReadonlyArray<string>): Array<{ key: string; members: string[] }> {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const key = name.toLowerCase().split(/[^a-z0-9]+/)[0]
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(name)
    else groups.set(key, [name])
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([key, members]) => ({ key, members }))
    .sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key))
}
