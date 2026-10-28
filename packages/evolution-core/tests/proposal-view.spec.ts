// @tier fast
import { expect, it } from 'vitest'
import { planExtract, proposalFromPlan } from '@deepseek-ai/dsh-evolution-core'

const NL = String.fromCharCode(10)
const body = ['# Demo', '', '## Details', '', 'reusable detail', '', '## Usage', '', 'Use it.'].join(NL)

it('projects a plan into a proposal without changing owner or outcome', () => {
  const plan = planExtract({
    body,
    sourceName: 'source',
    targetName: 'target',
    targetExists: true,
    outcome: 'extract',
    owner: { mode: 'covered', name: 'target', triggerCovers: true, outcomeCovers: true, reason: 'explicit' },
    requests: [{ heading: 'Details' }],
    sourceFiles: [],
    targetFiles: [],
  })
  expect(plan.ok).toBe(true)
  if (!plan.ok) return
  const proposal = proposalFromPlan(plan.plan, { runId: 'run-1', at: 1 })
  expect(proposal.version).toBe(1)
  expect(proposal.id).toBe('extract-run-1-source')
  expect(proposal.outcome).toBe('extract')
  expect(proposal.parts[0]?.anchor.heading).toBe('Details')
  expect(proposal.owner.mode).toBe('covered')
  expect(proposal.provenance).toEqual({ promptVersion: 'v1', runId: 'run-1', at: 1 })
  expect(proposal.status).toBe('proposed')
  expect(proposal.parts[0]?.heading).toBe('Details')
})
