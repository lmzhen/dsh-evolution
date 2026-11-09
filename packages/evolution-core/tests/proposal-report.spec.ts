// @tier fast
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, readProposalReport, readProposalReports, writeProposalReport, type ProposalView } from '@deepseek-ai/dsh-evolution-core'

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

it('reads one proposal by id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-proposal-one-'))
  try {
    const io = nodeEvolutionIo()
    await writeProposalReport(io, PROPOSAL, dir)
    expect(await readProposalReport(io, PROPOSAL.id, dir)).toMatchObject({ id: PROPOSAL.id, source: 'source' })
    expect(await readProposalReport(io, 'missing', dir)).toBeNull()
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

it('writes and reads the newest proposal reports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-proposal-report-'))
  try {
    const io = nodeEvolutionIo()
    await writeProposalReport(io, PROPOSAL, dir)
    const older = { ...PROPOSAL, id: 'extract-run-0-source', provenance: { ...PROPOSAL.provenance, runId: 'run-0' } }
    await writeProposalReport(io, older, dir)
    const rows = await readProposalReports(io, dir)
    expect(rows.map(row => row.id)).toEqual(['extract-run-1-source', 'extract-run-0-source'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
