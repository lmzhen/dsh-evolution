/**
 * Round-1/round-2 prompt builders. Pure strings; the channel adapter owns transport.
 * Round 1 may only decide; round 2 may only write the staged tree through merge_stage.
 */
import type { MergeDecision, MergeRow } from './contracts.ts'
import type { SkillCard } from './screening.ts'

export const MERGE_PROMPT_VERSION = 'merge-pair/v1'

const ROUND1_SYSTEM = 'You decide whether two skill documents describe the same reusable capability. Shared vocabulary or a shared preamble is not duplication. Return only strict JSON.'
const ROUND2_SYSTEM = 'You write the merged skill into the staging tree through the merge_stage tool. Never modify the live skill tree. Follow the supplied decision exactly.'

export function buildRound1Prompt(candidate: { readonly a: string; readonly b: string }, cards: readonly SkillCard[]): string {
  const byName = new Map(cards.map(card => [card.name, card]))
  const a = byName.get(candidate.a)
  const b = byName.get(candidate.b)
  return [
    ROUND1_SYSTEM,
    '',
    'Return JSON: {"should_merge":true|false,"mode":"merge-into-existing"|"create-umbrella"|"keep","target":"<name>","sources":["<name>","<name>"],"rationale":"<=120 chars","confidence":0..1}',
    'If not enough evidence, set should_merge=false and mode="keep".',
    '',
    'skill_a: ' + JSON.stringify({ name: candidate.a, description: a?.description ?? '', body: (a?.body ?? '').slice(0, 6000) }),
    'skill_b: ' + JSON.stringify({ name: candidate.b, description: b?.description ?? '', body: (b?.body ?? '').slice(0, 6000) }),
  ].join('\n')
}

export function buildRound2Prompt(row: MergeRow, decision: MergeDecision): string {
  return [
    ROUND2_SYSTEM,
    '',
    'decision: ' + JSON.stringify(decision),
    'pair: ' + JSON.stringify({ a: row.a, b: row.b }),
    'target: ' + JSON.stringify(decision.target),
    '',
    'Use merge_stage: list/read the source copies, write merged/' + decision.target + '/SKILL.md and any support files, then copy required support files. Do not write outside merged/' + decision.target + '/.',
    'When the staged target is complete, reply with one short sentence. Do not return a JSON plan.',
  ].join('\n')
}
