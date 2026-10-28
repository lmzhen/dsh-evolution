import { join } from 'node:path'
import type { EvolutionIoLike } from './io.ts'
import type { ProposalView } from './proposal-view.ts'
import { evolutionHome } from './state-store.ts'

/** Directory for the one proposal lane; reports are retention-swept with the other run reports. */
export function proposalReportDir(): string {
  return join(evolutionHome(), 'reports')
}

/** Stable report filename for one proposal; the id may carry path separators. */
export function proposalReportName(proposal: ProposalView): string {
  return 'extract-proposal-' + encodeURIComponent(proposal.id) + '.json'
}

/**
 * Persist one proposal as a report. Best-effort: a failed write never blocks the extract.
 * @param io - evolution IO seam.
 * @param proposal - proposal to persist.
 * @param dir - reports directory (tests pass a temp dir).
 * @returns the written path.
 */
export async function writeProposalReport(io: EvolutionIoLike, proposal: ProposalView, dir = proposalReportDir()): Promise<string> {
  const path = join(dir, proposalReportName(proposal))
  await io.writeText(path, JSON.stringify(proposal))
  return path
}

function isProposal(value: unknown): value is ProposalView {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { version?: unknown; id?: unknown; source?: unknown; outcome?: unknown }
  return candidate.version === 1 && typeof candidate.id === 'string' && typeof candidate.source === 'string'
    && (candidate.outcome === 'keep' || candidate.outcome === 'extract' || candidate.outcome === 'mixed' || candidate.outcome === 'owner-gap')
}

/**
 * Read the newest proposals. Missing/unreadable reports are skipped, never guessed.
 * @param io - evolution IO seam.
 * @param dir - reports directory.
 * @param limit - newest rows to return.
 * @returns valid proposals, newest filename first.
 */
export async function readProposalReports(io: EvolutionIoLike, dir = proposalReportDir(), limit = 10): Promise<ProposalView[]> {
  let names: string[]
  try {
    names = (await io.list(dir)).filter(name => name.startsWith('extract-proposal-') && name.endsWith('.json'))
  } catch {
    return []
  }
  names.sort((a, b) => b.localeCompare(a))
  const proposals: ProposalView[] = []
  for (const name of names.slice(0, limit)) {
    try {
      const raw = await io.readText(join(dir, name))
      if (raw === null) continue
      const parsed: unknown = JSON.parse(raw)
      if (isProposal(parsed)) proposals.push(parsed)
    } catch {
      // A malformed report is skipped; one bad file must not hide the rest.
    }
  }
  return proposals
}
