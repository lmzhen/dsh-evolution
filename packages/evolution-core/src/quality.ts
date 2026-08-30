/**
 * Quality scoring and near-duplicate detection for the curated skill library.
 *
 * Pure functions over data inputs so the scoring policy is unit-testable and
 * the same math feeds the usage sidecar, the `skill_manage review` surface and
 * the learning graph. Weights follow the Hermes/hermes-claw six-factor model;
 * mutation maturity is a documented DSH approximation (single per-month patch
 * trend ratio replaces the claw timestamp-trend formula, since DSH usage
 * records only carry the last patched timestamp).
 * @module @deepseek-ai/dsh-evolution-core
 */

import { createHash } from 'node:crypto'
import type { UsageMap } from './usage.ts'
import { latestActivityAt } from './usage.ts'

export interface QualityFactors {
  /** 0.25 — use_count per day of age, capped at 1. */
  usageFrequency: number
  /** 0.20 — 1 − patch/use (zero use = stable). */
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
  return Math.max(0, (now.getTime() - new Date(from).getTime()) / 86_400_000)
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
    const useCount = record.use_count

    const usageFrequency = clamp01(useCount / ageDays)
    const stability = useCount === 0 ? 1 : clamp01(1 - patchCount / useCount)
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

function contentHash(content: string): string {
  return createHash('sha256').update(normalize(content)).digest('hex')
}

function tokenize(content: string): Set<string> {
  return new Set(normalize(content).split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

/**
 * Two-phase near-duplicate clustering: exact normalized-hash groups first,
 * then token-Jaccard edges at {@link DEDUP_SIMILARITY_THRESHOLD} with a token
 * ratio guard, union-find across the whole set.
 */
export function computeDedupGroups(input: {
  contents: ReadonlyMap<string, string>
  threshold?: number
}): string[][] {
  const threshold = input.threshold ?? 0.95
  const names = [...input.contents.keys()]
  const hashes = new Map<string, string[]>()
  for (const name of names) {
    const hash = contentHash(input.contents.get(name) ?? '')
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
  for (const [hash, bucketNames] of hashes) {
    void hash
    const first = bucketNames[0]
    if (first === undefined || bucketNames.length === 1) continue
    for (let index = 1; index < bucketNames.length; index += 1) {
      const peer = bucketNames[index]
      if (peer) union(first, peer)
    }
  }
  const tokens = new Map<string, Set<string>>()
  const tokenSet = (name: string): Set<string> => {
    let set = tokens.get(name)
    if (!set) {
      set = tokenize(input.contents.get(name) ?? '')
      tokens.set(name, set)
    }
    return set
  }
  for (let index = 0; index < names.length; index += 1) {
    const a = names[index]
    if (a === undefined) continue
    for (let other = index + 1; other < names.length; other += 1) {
      const b = names[other]
      if (b === undefined) continue
      const [ta, tb] = [tokenSet(a), tokenSet(b)]
      if (Math.max(ta.size, tb.size) / Math.max(1, Math.min(ta.size, tb.size)) > 5) continue
      if (jaccard(ta, tb) >= threshold) union(a, b)
    }
  }
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const root = find(name)
    const group = groups.get(root)
    if (group) group.push(name)
    else groups.set(root, [name])
  }
  return [...groups.values()].filter(group => group.length > 1)
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
