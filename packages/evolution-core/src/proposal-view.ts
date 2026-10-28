import type { ExtractOutcome, ExtractPlanDraft, OwnerDecision, SupportClosure } from './extract-plan.ts'

/** The semantic outcome a proposal may carry; keep is valid even though planExtract only plans a split. */
export type ProposalOutcome = ExtractOutcome | 'keep'

/** One semantic proposal carried to health/panel/audit surfaces. */
export interface ProposalView {
  version: 1
  id: string
  source: string
  outcome: ProposalOutcome
  parts: Array<{ heading: string; anchor: { heading: string; start?: string; end?: string }; reason: string }>
  owner: OwnerDecision
  support?: SupportClosure
  warnings: string[]
  provenance: { promptVersion: 'v1'; runId: string; at: number }
  status: 'proposed' | 'previewed' | 'stale' | 'dismissed'
}

/**
 * Project a pure ExtractPlan into the proposal record every read-only surface consumes.
 *
 * This is a projection, not a second evaluator: it keeps the plan's owner decision,
 * support closure and warnings. It never writes and never invents coverage.
 * @param plan - plan produced by planExtract.
 * @param provenance - run id and timestamp for the proposing pass.
 * @returns a proposal with status proposed.
 */
export function proposalFromPlan(
  plan: ExtractPlanDraft,
  provenance: { runId: string; at?: number },
): ProposalView {
  return {
    version: 1,
    id: 'extract-' + provenance.runId + '-' + plan.source,
    source: plan.source,
    outcome: plan.outcome,
    parts: plan.parts.map(part => ({ heading: part.heading, anchor: part.anchor, reason: part.sourceText.slice(0, 160) })),
    owner: plan.owner,
    support: plan.support,
    warnings: plan.warnings,
    provenance: { promptVersion: 'v1', runId: provenance.runId, at: provenance.at ?? Date.now() },
    status: 'proposed',
  }
}
