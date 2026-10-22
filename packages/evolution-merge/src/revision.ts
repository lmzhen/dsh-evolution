import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import type { SkillCard } from './skill-card.ts'

function fingerprint(card: SkillCard): string {
  const files = [...(card.files ?? [])].sort((left, right) => left.path.localeCompare(right.path))
  return card.name + '\u0000' + card.body + '\u0000' + files.map(file => file.path + '\u0000' + file.content).join('\u0000')
}

/** Stable source revision for a pair: names sorted, body+support hashed in that order. */
export function sourceRevisionOf(cards: readonly SkillCard[], a: string, b: string): string | undefined {
  const byName = new Map(cards.map(card => [card.name, card]))
  const names = [a, b].sort()
  const first = byName.get(names[0] ?? '')
  const second = byName.get(names[1] ?? '')
  if (first === undefined || second === undefined) return undefined
  return contentHash(fingerprint(first) + '\u0000' + fingerprint(second))
}

/** Revision of the merge target; undefined when the target is not a live card. */
export function targetRevisionOf(cards: readonly SkillCard[], target: string): string | undefined {
  const card = cards.find(item => item.name === target)
  return card === undefined ? undefined : contentHash(fingerprint(card))
}
