/** One independent judge's EVAL-010 labels. */
export interface JudgeObservation { readonly queryId: string; readonly relevant: boolean; readonly note?: string | undefined }
export interface JudgeRecord {
  readonly schemaVersion: 1
  readonly querySet: 'eval-010'
  readonly judgeKind: 'model' | 'human'
  readonly judgeId: string
  readonly observations: readonly JudgeObservation[]
}

/** Validate a judge packet without accepting partial query coverage. */
export function validateJudgeRecord(record: JudgeRecord, expectedQueryIds: readonly string[]): readonly string[] {
  const errors: string[] = []
  if (record.schemaVersion !== 1 || record.querySet !== 'eval-010' || (record.judgeKind !== 'model' && record.judgeKind !== 'human')) errors.push('schema-invalid')
  if (record.judgeId.trim().length === 0) errors.push('judge-id-missing')
  const seen = new Set<string>()
  for (const observation of record.observations) {
    if (!expectedQueryIds.includes(observation.queryId)) errors.push('unknown-query:' + observation.queryId)
    if (seen.has(observation.queryId)) errors.push('duplicate-query:' + observation.queryId)
    seen.add(observation.queryId)
  }
  for (const id of expectedQueryIds) if (!seen.has(id)) errors.push('missing-query:' + id)
  return errors
}

/** Aggregate two independent judges; no label is rewritten. */
export interface JudgeAggregate {
  readonly queryCount: number
  readonly relevantRate: number | null
  readonly agreementRate: number | null
  readonly hasModel: boolean
  readonly hasHuman: boolean
}

/** @returns aggregate over model/human records; agreement only for shared queries. */
export function aggregateJudge(records: readonly JudgeRecord[], expectedQueryIds: readonly string[]): JudgeAggregate {
  const model = records.find(record => record.judgeKind === 'model')
  const human = records.find(record => record.judgeKind === 'human')
  const modelLabels = new Map(model?.observations.map(item => [item.queryId, item.relevant]) ?? [])
  const humanLabels = new Map(human?.observations.map(item => [item.queryId, item.relevant]) ?? [])
  const union = [...new Set([...modelLabels.keys(), ...humanLabels.keys()])]
  const relevant = union.filter(id => (modelLabels.get(id) ?? humanLabels.get(id)) === true).length
  const shared = [...modelLabels.keys()].filter(id => humanLabels.has(id))
  return {
    queryCount: expectedQueryIds.length,
    relevantRate: union.length === 0 ? null : relevant / union.length,
    agreementRate: shared.length === 0 ? null : shared.filter(id => modelLabels.get(id) === humanLabels.get(id)).length / shared.length,
    hasModel: model !== undefined,
    hasHuman: human !== undefined,
  }
}
