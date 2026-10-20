// @tier pre-tag
import { expect, it } from 'vitest'
import { GateCache, parseVerdict, runLadder, type GateFacts, type GateModelPort } from '../src/index.ts'

const facts: GateFacts[] = [
  { name: 'alpha-skill', description: 'alpha', body: 'alpha body' },
  { name: 'beta-skill', description: 'beta', body: 'beta body' },
]
const candidate = { a: 'alpha-skill', b: 'beta-skill', score: 0.6 }
const signal = new AbortController().signal

it('routes merge through L0/L1/L2 and stops on L0 keep', async () => {
  const values = [{ verdict: 1, reason: 'likely' }, { verdict: 0, reason: 'need body' }, { verdict: 1, reason: 'merge' }]
  let calls = 0
  const model: GateModelPort = { async callJson() { return values[calls++] } }
  const result = await runLadder({ level: 'L0', candidate, facts, model, modelName: 'm', signal })
  expect(result).toMatchObject({ route: 'merge', calls: 3 })
  expect(result.verdicts.map(verdict => verdict.level)).toEqual(['L0', 'L1', 'L2'])

  let one = 0
  const keep: GateModelPort = { async callJson() { one += 1; return { verdict: -1, reason: 'different' } } }
  expect(await runLadder({ level: 'L0', candidate, facts, model: keep, modelName: 'm', signal })).toMatchObject({ route: 'keep', droppedAt: 'L0', calls: 1 })
  expect(one).toBe(1)
})

it('accepts fenced JSON and caches by payload', async () => {
  expect(parseVerdict('L2', '\`\`\`json\n{"verdict":0,"reason":"maybe"}\n\`\`\`')).toMatchObject({ verdict: 0, reason: 'maybe' })
  const cache = new GateCache()
  const model: GateModelPort = { async callJson() { return { verdict: 0, reason: 'maybe' } } }
  const first = await runLadder({ level: 'L0', candidate, facts, model, modelName: 'm', signal, cache })
  expect(first.calls).toBe(3)
  const second = await runLadder({ level: 'L0', candidate, facts, model, modelName: 'm', signal, cache })
  expect(second.calls).toBe(0)
  expect(second.verdicts.every(verdict => verdict.cached)).toBe(true)
})
