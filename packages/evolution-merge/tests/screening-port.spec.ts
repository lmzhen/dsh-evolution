// @tier pre-tag
import { expect, it } from 'vitest'
import { buildScreeningCandidates, createScreeningForRun, type GateModelPort, type ModelPort, type SkillCard } from '../src/index.ts'

const cards: SkillCard[] = [
  { name: 'alpha-skill', description: 'same description', body: 'same body' },
  { name: 'beta-skill', description: 'same description', body: 'same body' },
  { name: 'gamma-skill', description: 'different', body: 'different' },
]
const signal = new AbortController().signal

it('combines lexical and proposed candidates without duplicates', async () => {
  const proposal: ModelPort = { async callJson() { return { pairs: [{ a: 'alpha-skill', b: 'beta-skill', reason: 'same' }] } } }
  const result = await buildScreeningCandidates({ cards, signal, propose: { model: proposal } })
  expect(result.stats.lexical).toBeGreaterThan(0)
  expect(result.stats.proposed).toBe(1)
  expect(result.candidates.filter(pair => pair.a === 'alpha-skill' && pair.b === 'beta-skill')).toHaveLength(1)
})

it('filters through the gate and carries the gate fact', async () => {
  const gate: GateModelPort = {
    async callJson(request) {
      const payload = JSON.parse(request.user) as { level: string }
      return { verdict: payload.level === 'L2' ? 1 : payload.level === 'L1' ? 0 : 1, reason: payload.level }
    },
  }
  const result = await buildScreeningCandidates({
    cards, signal, gate: { model: gate, modelName: 'm', runSeed: 'seed', auditRate: 0 },
  })
  expect(result.stats.dropped).toBe(0)
  expect(result.stats.kept).toBeGreaterThan(0)
  expect(result.candidates[0]?.gate).toMatchObject({ level: 'L2', verdict: 1 })
})

it('builds a run-scoped screening function with the gate seed', async () => {
  const gate: GateModelPort = {
    async callJson(request) {
      const payload = JSON.parse(request.user) as { level: string }
      return { verdict: payload.level === 'L1' ? 0 : 1, reason: payload.level }
    },
  }
  const run = createScreeningForRun({ cards, runSeed: 'run-seed', gate: { model: gate, modelName: 'm', runSeed: 'old' } })
  const candidates = await run(signal)
  expect(candidates.length).toBeGreaterThan(0)
  expect(candidates[0]?.gate).toMatchObject({ level: 'L2', verdict: 1 })
})
