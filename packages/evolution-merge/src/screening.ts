/**
 * Deterministic candidate screening: name prefilter + lexical affinity.
 *
 * The semantic proposer (C3) is a separate port; this module is the zero-cost floor that
 * must work without a model. It reuses core `vocabulary`/`affinity` so drift/dedup and
 * merge screening share one tokenizer.
 */
import { affinity, vocabulary } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCandidate } from './contracts.ts'

export interface SkillCard {
  readonly name: string
  readonly description: string
  readonly body: string
}

export interface ScreeningOptions {
  /** Body Jaccard at/above this is a candidate on its own. */
  readonly bodyGate?: number
  /** Description Jaccard at/above this is a candidate when the body also clears minAffinity. */
  readonly summaryGate?: number
  /** Minimum body affinity for a summary-led candidate. */
  readonly minAffinity?: number
  /** Upper bound after sorting by score; absent = no cap. */
  readonly maxCandidates?: number
}

export interface ScreeningStats {
  readonly skills: number
  readonly filtered: number
  readonly candidates: number
}

export interface ScreeningResult {
  readonly candidates: readonly MergeCandidate[]
  readonly stats: ScreeningStats
}

/** Shannon entropy over characters; a cheap prefilter signal, not a name-quality judge. */
export function nameEntropy(name: string): number {
  if (name === '') return 0
  const counts = new Map<string, number>()
  for (const char of name) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / name.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

const MIN_NAME_ENTROPY = 1.5
const MIN_NAME_LENGTH = 6

export function prefilter(cards: readonly SkillCard[]): readonly SkillCard[] {
  return cards.filter((card) => {
    const name = card.name.trim()
    if (name.length < MIN_NAME_LENGTH) return false
    if (nameEntropy(name) < MIN_NAME_ENTROPY) return false
    return card.body.trim() !== '' || card.description.trim() !== ''
  })
}

function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export function lexicalCandidates(cards: readonly SkillCard[], options: ScreeningOptions = {}): ScreeningResult {
  const bodyGate = options.bodyGate ?? 0.9
  const summaryGate = options.summaryGate ?? 0.5
  const minAffinity = options.minAffinity ?? 0.3
  const eligible = prefilter(cards)
  const vectors = eligible.map(card => ({
    card,
    summary: vocabulary(card.description),
    body: vocabulary(card.body),
  }))
  const candidates: MergeCandidate[] = []
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const left = vectors[i]
      const right = vectors[j]
      if (left === undefined || right === undefined) continue
      const summary = affinity(left.summary, right.summary)
      const body = affinity(left.body, right.body)
      const arms: string[] = []
      if (body >= bodyGate) arms.push('body')
      if (summary >= summaryGate && body >= minAffinity) arms.push('summary')
      if (arms.length === 0) continue
      const [a, b] = sortedPair(left.card.name, right.card.name)
      candidates.push({ a, b, score: Math.max(body, summary), arms, source: 'lexical' })
    }
  }
  candidates.sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.a.localeCompare(right.a) || left.b.localeCompare(right.b))
  const capped = options.maxCandidates === undefined ? candidates : candidates.slice(0, options.maxCandidates)
  return {
    candidates: capped,
    stats: { skills: cards.length, filtered: cards.length - eligible.length, candidates: capped.length },
  }
}
