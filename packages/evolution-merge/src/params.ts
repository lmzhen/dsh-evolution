/**
 * Merge parameter resolution. E2/E3 values arrive as one JSON object; this is the only
 * validator. Invalid values throw loudly (no silent clamp), matching the screening contract.
 */
export interface MergeParams {
  readonly mergeApproval: boolean
  readonly mergeSkippedTtlDays: number
  readonly mergeRunTimeoutMinutes: number
  readonly mergePairTimeoutMinutes: number
  readonly mergeModelsRoot: string
}

export const MERGE_PARAM_DEFAULTS: MergeParams = {
  mergeApproval: false,
  mergeSkippedTtlDays: 0,
  mergeRunTimeoutMinutes: 0,
  mergePairTimeoutMinutes: 15,
  mergeModelsRoot: '',
}

const KEYS = new Set(Object.keys(MERGE_PARAM_DEFAULTS))

function materialize<T>(value: T): T {
  if (typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function') {
    return (value as unknown as { get(): T }).get()
  }
  return value
}

function nonNegative(name: string, value: unknown): number {
  const resolved = materialize(value)
  if (typeof resolved !== 'number' || !Number.isInteger(resolved) || resolved < 0) throw new Error(name + ' must be a non-negative integer')
  return resolved
}

export function resolveMergeParams(input: unknown = {}): MergeParams {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('merge params must be an object')
  for (const key of Object.keys(input)) if (!KEYS.has(key)) throw new Error('unknown merge parameter: ' + key)
  const record = input as Record<string, unknown>
  const approval = record.mergeApproval === undefined ? MERGE_PARAM_DEFAULTS.mergeApproval : materialize(record.mergeApproval)
  if (typeof approval !== 'boolean') throw new Error('mergeApproval must be a boolean')
  return {
    mergeApproval: approval,
    mergeSkippedTtlDays: record.mergeSkippedTtlDays === undefined ? MERGE_PARAM_DEFAULTS.mergeSkippedTtlDays : nonNegative('mergeSkippedTtlDays', record.mergeSkippedTtlDays),
    mergeRunTimeoutMinutes: record.mergeRunTimeoutMinutes === undefined ? MERGE_PARAM_DEFAULTS.mergeRunTimeoutMinutes : nonNegative('mergeRunTimeoutMinutes', record.mergeRunTimeoutMinutes),
    mergeModelsRoot: record.mergeModelsRoot === undefined ? MERGE_PARAM_DEFAULTS.mergeModelsRoot : (() => {
      const value = materialize(record.mergeModelsRoot)
      if (typeof value !== 'string') throw new Error('mergeModelsRoot must be a string')
      return value
    })(),
    mergePairTimeoutMinutes: record.mergePairTimeoutMinutes === undefined ? MERGE_PARAM_DEFAULTS.mergePairTimeoutMinutes : (() => {
      const value = nonNegative('mergePairTimeoutMinutes', record.mergePairTimeoutMinutes)
      if (value === 0) throw new Error('mergePairTimeoutMinutes must be > 0')
      return value
    })(),
  }
}
