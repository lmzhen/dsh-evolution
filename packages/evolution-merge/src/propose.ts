/**
 * C3 semantic proposer: one library-level model call (sharded when the library is large)
 * that proposes candidate pairs. It never judges merge quality; L0–L2 does that.
 */
import type { MergeCandidate } from './contracts.ts'
import type { SkillCard } from './skill-card.ts'

export interface ModelPort {
  callJson(request: {
    readonly system: string
    readonly user: string
    readonly maxTokens: number
    readonly signal: AbortSignal
  }): Promise<unknown>
}

export interface ProposeOptions {
  readonly shardSize?: number
  readonly maxPairs?: number
  readonly signal: AbortSignal
}

export interface ProposeResult {
  readonly candidates: readonly MergeCandidate[]
  readonly shards: number
  readonly degraded: readonly string[]
}

const SYSTEM = 'You propose skill pairs that may be merged. Return only a JSON object: {"pairs":[{"a":"skill-a","b":"skill-b","reason":"one sentence"}]}. Use only supplied skill names. Do not decide whether a merge is good.'

function parsePairs(raw: unknown, known: ReadonlySet<string>, cap: number): MergeCandidate[] {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { return [] }
  }
  if (typeof value !== 'object' || value === null) return []
  const pairs = (value as { pairs?: unknown }).pairs
  if (!Array.isArray(pairs)) return []
  const out: MergeCandidate[] = []
  const seen = new Set<string>()
  for (const item of pairs) {
    if (out.length >= cap) break
    const pair = item as { a?: unknown; b?: unknown; reason?: unknown }
    if (typeof pair.a !== 'string' || typeof pair.b !== 'string') continue
    const a = pair.a.trim()
    const b = pair.b.trim()
    if (a === b || !known.has(a) || !known.has(b)) continue
    const [first, second] = a < b ? [a, b] : [b, a]
    const key = first + '\u0000' + second
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ a: first, b: second, source: 'proposed', ...(typeof pair.reason === 'string' && pair.reason.trim() !== '' ? { reason: pair.reason.trim() } : {}) })
  }
  return out
}

export async function proposePairs(cards: readonly SkillCard[], port: ModelPort, options: ProposeOptions): Promise<ProposeResult> {
  const shardSize = Math.max(2, options.shardSize ?? 60)
  const cap = Math.max(0, options.maxPairs ?? 200)
  const known = new Set(cards.map(card => card.name))
  const candidates: MergeCandidate[] = []
  const degraded: string[] = []
  let shards = 0
  for (let start = 0; start < cards.length && candidates.length < cap; start += shardSize) {
    const shard = cards.slice(start, start + shardSize)
    if (shard.length < 2) continue
    shards += 1
    try {
      const raw = await port.callJson({
        system: SYSTEM,
        user: JSON.stringify(shard.map(card => ({
          name: card.name,
          description: card.description.slice(0, 400),
          body: card.body.slice(0, 600),
        }))),
        maxTokens: 1200,
        signal: options.signal,
      })
      candidates.push(...parsePairs(raw, known, cap - candidates.length))
    } catch (error) {
      degraded.push('proposal shard failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  return { candidates, shards, degraded }
}
