import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import type { SkillCard } from './skill-card.ts'

/** Stable source revision for a pair: names sorted, body hashed in that order. */
export function sourceRevisionOf(cards: readonly SkillCard[], a: string, b: string): string | undefined {
  const byName = new Map(cards.map(card => [card.name, card]))
  const names = [a, b].sort()
  const first = byName.get(names[0] ?? '')
  const second = byName.get(names[1] ?? '')
  if (first === undefined || second === undefined) return undefined
  return contentHash(first.name + '\u0000' + first.body + '\u0000' + second.name + '\u0000' + second.body)
}
