import { contentHash, revisionFingerprint, revisionSupportDigest } from '@deepseek-ai/dsh-evolution-core'
import type { SkillCard } from './skill-card.ts'
import type { RevisionRef } from './contracts.ts'

function fingerprint(card: SkillCard): string {
  return revisionFingerprint(card.name, card.body, card.files ?? [])
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

export function targetRevisionRefOf(cards: readonly SkillCard[], target: string): RevisionRef {
  const revision = targetRevisionOf(cards, target)
  return revision === undefined ? { kind: 'absent' } : { kind: 'present', sha256: revision }
}

/** Per-skill anchors for a set of names; absent names stay `kind: 'absent'` so a
 *  later commit can tell "was not there" from "was not checked". */
export function sourceRevisionRefsOf(cards: readonly SkillCard[], names: readonly string[]): Readonly<Record<string, RevisionRef>> {
  const byName = new Map(cards.map(card => [card.name, card]))
  const out: Record<string, RevisionRef> = {}
  for (const name of [...new Set(names)].sort()) {
    const card = byName.get(name)
    out[name] = card === undefined ? { kind: 'absent' } : { kind: 'present', sha256: contentHash(fingerprint(card)) }
  }
  return out
}

export function sourceRevisionRefOf(cards: readonly SkillCard[], a: string, b: string): RevisionRef {
  const revision = sourceRevisionOf(cards, a, b)
  return revision === undefined ? { kind: 'absent' } : { kind: 'present', sha256: revision }
}

/** Record the round-1 anchors a later commit re-checks (target/source/support). */
export function withDecisionRevisions<T extends { readonly target: string }>(decision: T, cards: readonly SkillCard[], a: string, b: string): T & { readonly targetRevisionRef: RevisionRef; readonly sourceRevisionRef: RevisionRef; readonly sourceRevisions: Readonly<Record<string, RevisionRef>>; readonly supportDigest: string } {
  return { ...decision, targetRevisionRef: targetRevisionRefOf(cards, decision.target), sourceRevisionRef: sourceRevisionRefOf(cards, a, b), sourceRevisions: sourceRevisionRefsOf(cards, [a, b]), supportDigest: supportDigestOf(cards, [decision.target, a, b]) }
}

export function supportDigestOf(cards: readonly SkillCard[], names: readonly string[]): string {
  const byName = new Map(cards.map(card => [card.name, card]))
  const involved = [...new Set(names)].map(name => byName.get(name)).filter((card): card is SkillCard => card !== undefined)
  return revisionSupportDigest(involved.map(fingerprint))
}

export function revisionMismatch(expected: RevisionRef | undefined, current: RevisionRef): 'target-taken' | 'source-changed' | null {
  if (expected === undefined) return null
  if (expected.kind !== current.kind) return 'target-taken'
  if (expected.kind === 'absent') return null
  return current.kind === 'present' && expected.sha256 === current.sha256 ? null : 'target-taken'
}
