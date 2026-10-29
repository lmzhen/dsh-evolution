// @tier fast
import { expect, it } from 'vitest'
import type { ProposalView } from '@deepseek-ai/dsh-evolution-core'
import type { DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { makeSkillHealthRoutes, ROUTES, toRouteRows } from '../src/routes.ts'

it('keeps needs-restructure, severity, message and dims in the route row', () => {
  const rows = toRouteRows([{
    name: 'fat',
    verdict: 'needs-restructure',
    findings: [{ rule: 'body-oversize-2x', count: 1, line: 'line 4', severity: 'error', message: 'body twice the soft line' }],
    dims: { bodyChars: 41000, bodyTokens: 16000, supportGroups: 2, supportFiles: 8, churnPatches: 3, churnReads: 7, stampDensityPerKb: 0.2 },
  }])
  expect(rows[0]?.verdict).toBe('needs-restructure')
  expect(rows[0]?.findings[0]).toMatchObject({ severity: 'error', message: 'body twice the soft line' })
  expect(rows[0]?.dims).toMatchObject({ bodyChars: 41000, supportFiles: 8, churnPatches: 3 })
})

it('normalizes the host healthy verdict to the panel ok vocabulary', () => {
  const rows = toRouteRows([{ name: 'fine', verdict: 'healthy', findings: [] }])
  expect(rows[0]?.verdict).toBe('healthy')
})

it('keeps an unreadable row unreadable even when the verdict says otherwise', () => {
  const rows = toRouteRows([{ name: 'bad', verdict: 'ok', findings: [], dims: { readable: false } }])
  expect(rows[0]?.verdict).toBe('unreadable')
})

const AUDIT: DecisionAudit = { channel: 'connection.fetch', principal: 'owner', deploymentAllowsRemote: false }

const PROPOSAL: ProposalView = {
  version: 1,
  id: 'extract-run-1-source',
  source: 'source',
  outcome: 'extract',
  parts: [],
  owner: { mode: 'covered', name: 'target', triggerCovers: true, outcomeCovers: true, reason: 'explicit' },
  warnings: [],
  provenance: { promptVersion: 'v1', runId: 'run-1', at: 1 },
  status: 'proposed',
}

it('projects the proposal seam into the payload', async () => {
  const route = makeSkillHealthRoutes({
    getCurator: () => ({ healthView: async () => [] }),
    getProposals: () => [PROPOSAL],
  }, AUDIT)[0]!
  const response = await route.fetch(new Request('http://localhost' + ROUTES.rows, { method: 'GET' }))
  const body = await response.json() as { ok: boolean; data: { proposals: ProposalView[]; proposalStatus: string } }
  expect(body.ok).toBe(true)
  expect(body.data.proposalStatus).toBe('available')
  expect(body.data.proposals[0]?.id).toBe('extract-run-1-source')
})

it('says unavailable when no proposal seam is mounted', async () => {
  const route = makeSkillHealthRoutes({ getCurator: () => ({ healthView: async () => [] }) }, AUDIT)[0]!
  const response = await route.fetch(new Request('http://localhost' + ROUTES.rows, { method: 'GET' }))
  const body = await response.json() as { ok: boolean; data: { proposals: ProposalView[]; proposalStatus: string } }
  expect(body.data.proposals).toEqual([])
  expect(body.data.proposalStatus).toBe('unavailable')
})
