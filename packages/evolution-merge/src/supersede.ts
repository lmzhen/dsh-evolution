/**
 * A tree restore invalidates earlier merge runs: their commit receipts may describe a tree
 * that no longer exists. Mark every non-superseded merge run in this process's registry.
 */
import type { RunRecord, RunRegistry } from '@deepseek-ai/dsh-evolution-core'

export function mergeRunIdsToSupersede(runs: readonly RunRecord[]): readonly string[] {
  return runs.filter(run => run.kind === 'merge' && run.supersededAt === undefined).map(run => run.id)
}

export async function supersedeMergeRuns(registry: RunRegistry): Promise<number> {
  const ids = mergeRunIdsToSupersede(registry.runs())
  if (ids.length === 0) return 0
  await registry.supersede(ids)
  return ids.length
}
