/**
 * Round-1 decision parser. The child returns text; the plugin owns strict shape checks.
 * Accepts a whole JSON object or a fenced json block; everything else is decision-invalid.
 */
import type { MergeDecision } from './contracts.ts'

export type DecisionParse =
  | { readonly ok: true; readonly decision: MergeDecision }
  | { readonly ok: false; readonly code: 'decision-invalid'; readonly message: string }

function extractJson(text: string): unknown {
  const fenced = /\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i.exec(text)
  const body = fenced?.[1] ?? text
  const start = body.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  for (let index = start; index < body.length; index += 1) {
    if (body[index] === '{') depth += 1
    else if (body[index] === '}') {
      depth -= 1
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, index + 1)) } catch { return undefined }
      }
    }
  }
  return undefined
}

export function parseDecision(text: string | undefined, pair: { readonly a: string; readonly b: string }): DecisionParse {
  if (text === undefined || text.trim() === '') return { ok: false, code: 'decision-invalid', message: 'empty decision text' }
  const value = extractJson(text)
  if (typeof value !== 'object' || value === null) return { ok: false, code: 'decision-invalid', message: 'decision is not a JSON object' }
  const record = value as Record<string, unknown>
  const shouldMerge = record.shouldMerge === true || record.should_merge === true
  const mode = record.mode
  if (mode !== 'merge-into-existing' && mode !== 'create-umbrella' && mode !== 'keep') {
    return { ok: false, code: 'decision-invalid', message: 'mode must be merge-into-existing, create-umbrella or keep' }
  }
  const target = typeof record.target === 'string' ? record.target.trim() : ''
  const sources = Array.isArray(record.sources) ? record.sources.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : []
  const rationale = typeof record.rationale === 'string' ? record.rationale.trim() : ''
  const aSummary = typeof record.aSummary === 'string' ? record.aSummary.trim() : typeof record.a_summary === 'string' ? record.a_summary.trim() : ''
  const bSummary = typeof record.bSummary === 'string' ? record.bSummary.trim() : typeof record.b_summary === 'string' ? record.b_summary.trim() : ''
  const summaries = { ...(aSummary === '' ? {} : { aSummary }), ...(bSummary === '' ? {} : { bSummary }) }
  if (!shouldMerge || mode === 'keep') {
    return { ok: true, decision: { shouldMerge: false, mode: 'keep', target, sources, rationale, ...summaries } }
  }
  if (target === '') return { ok: false, code: 'decision-invalid', message: 'merge decision needs target' }
  if (sources.length === 0) return { ok: false, code: 'decision-invalid', message: 'merge decision needs sources' }
  if (!sources.includes(pair.a) || !sources.includes(pair.b)) return { ok: false, code: 'decision-invalid', message: 'sources must include both pair skills' }
  return {
    ok: true,
    decision: {
      shouldMerge: true,
      mode,
      target,
      sources,
      rationale,
      ...summaries,
      ...(typeof record.confidence === 'number' ? { confidence: record.confidence } : {}),
    },
  }
}
