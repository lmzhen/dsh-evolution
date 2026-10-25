/** OI-11 engine input allowlist: exactly modelsRoot/reportOnly/maxTokens/timeoutMs. */
export interface EngineInput { readonly modelsRoot: string; readonly reportOnly: boolean; readonly maxTokens: number; readonly timeoutMs: number }
const ALLOWED = new Set(['modelsRoot', 'reportOnly', 'maxTokens', 'timeoutMs'])
export const ENGINE_FORBIDDEN_KEYS = ['offline', 'auto_provision', 'embed_backend', 'rank_mode', 'models_dir', 'embedder_model', 'embedder_model_last', 'judge'] as const
function integer(name: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(name + ' must be a non-negative integer')
  return value
}
export function resolveEngineInput(input: unknown = {}): EngineInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('engine input must be an object')
  for (const key of Object.keys(input)) {
    if ((ENGINE_FORBIDDEN_KEYS as readonly string[]).includes(key)) throw new Error('engine input key is forbidden: ' + key)
    if (!ALLOWED.has(key)) throw new Error('unknown engine input: ' + key)
  }
  const record = input as Record<string, unknown>
  if (record.modelsRoot !== undefined && typeof record.modelsRoot !== 'string') throw new Error('modelsRoot must be a string')
  if (record.reportOnly !== undefined && typeof record.reportOnly !== 'boolean') throw new Error('reportOnly must be a boolean')
  return { modelsRoot: typeof record.modelsRoot === 'string' ? record.modelsRoot : '', reportOnly: record.reportOnly === true, maxTokens: integer('maxTokens', record.maxTokens, 0), timeoutMs: integer('timeoutMs', record.timeoutMs, 0) }
}
