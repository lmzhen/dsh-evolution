// @tier fast
import { expect, it } from 'vitest'
import { healthViewModel } from '../src/client/health-presentation.ts'
import type { HealthRow } from '../src/client/Panel.ts'

const row = (name: string, verdict: HealthRow['verdict']): HealthRow => ({ name, verdict, findings: [] })

it('puts non-healthy verdicts first, including unreadable, and folds only healthy rows', () => {
  const model = healthViewModel([
    row('ok-a', 'healthy'), row('warn-a', 'warn'), row('bad', 'unreadable'), row('ok-b', 'healthy'),
  ])
  expect(model.issues.map(entry => entry.name)).toEqual(['warn-a', 'bad'])
  expect(model.normal.map(entry => entry.name)).toEqual(['ok-a', 'ok-b'])
  expect(model.hasIssues).toBe(true)
})

it('reports a clean model when every row is healthy', () => {
  const model = healthViewModel([row('ok', 'healthy')])
  expect(model.issues).toHaveLength(0)
  expect(model.normal).toHaveLength(1)
  expect(model.hasIssues).toBe(false)
})
