// @tier pre-tag
import { expect, it } from 'vitest'
import { filterCandidates } from '../src/gate-filter.ts'
import type { GateFacts, GateModelPort } from '../src/ladder.ts'
import type { MergeCandidate } from '../src/contracts.ts'

const facts: GateFacts[] = [
  { name: 'alpha-skill', description: 'a', body: 'a' },
  { name: 'beta-skill', description: 'b', body: 'b' },
]
const candidate: MergeCandidate = { a: 'alpha-skill', b: 'beta-skill', score: 0.7 }
const signal = new AbortController().signal

function levelModel(map: Record<string, number>): GateModelPort {
  return {
    async callJson(request) {
      const payload = JSON.parse(request.user) as { level: string }
      return { verdict: map[payload.level] ?? 0, reason: payload.level }
    },
  }
}

it('keeps a candidate that reaches L2 merge', async () => {
  const result = await filterCandidates([candidate], {
    facts, model: levelModel({ L0: 1, L1: 0, L2: 1 }), modelName: 'm', signal, runSeed: 'seed',
  })
  expect(result.kept).toHaveLength(1)
  expect(result.kept[0]?.candidate.gate).toMatchObject({ level: 'L2', verdict: 1 })
  expect(result.dropped).toHaveLength(0)
  expect(result.calls).toBe(3)
})

it('drops L0 keep and keeps an audited override', async () => {
  const dropped = await filterCandidates([candidate], {
    facts, model: levelModel({ L0: -1 }), modelName: 'm', signal, runSeed: 'no-audit', auditRate: 0,
  })
  expect(dropped.dropped).toHaveLength(1)
  expect(dropped.calls).toBe(1)

  const audited = await filterCandidates([candidate], {
    facts, model: levelModel({ L0: -1, L2: 1 }), modelName: 'm', signal, runSeed: 'audit', auditRate: 1,
  })
  expect(audited.kept).toHaveLength(1)
  expect(audited.kept[0]?.auditOverride).toBe(true)
  expect(audited.kept[0]?.candidate.gate).toMatchObject({ level: 'L2', verdict: 1, auditOverride: true })
  expect(audited.calls).toBe(2)
})

it('records a gate error instead of silently keeping', async () => {
  const result = await filterCandidates([candidate], {
    facts, model: { async callJson() { throw new Error('down') } }, modelName: 'm', signal, runSeed: 'seed',
  })
  expect(result.kept).toHaveLength(0)
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]?.message).toBe('down')
})
