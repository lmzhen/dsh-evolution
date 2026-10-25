/** Canonical evidence JSON hash shared with core unit receipts. */
import { createHash } from 'node:crypto'
import type { UnitEvidenceRecord } from '@deepseek-ai/dsh-evolution-core'
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}'
}
export function evidenceSha256(evidence: UnitEvidenceRecord): string {
  return createHash('sha256').update(canonical({ ...evidence, at: 0, mutations: 0 })).digest('hex')
}
