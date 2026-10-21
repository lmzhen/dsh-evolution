/**
 * L0–L2 candidate gate. This is a CANDIDATE classifier, not a content quality judge.
 * Routing follows the frozen table: L0 -1 stops; L0 1/0 → L1; L1 -1 stops; L1 0/1 → L2;
 * L2 1 → agent1; L2 0 → agent1 (undecided); L2 -1 → skipped.
 */
import { createHash } from 'node:crypto'

export type GateLevel = 'L0' | 'L1' | 'L2'
export type GateVerdictValue = 1 | 0 | -1

export interface GateFacts {
  readonly name: string
  readonly description: string
  readonly body: string
}

export interface GateCandidate {
  readonly a: string
  readonly b: string
  readonly score?: number
}

export interface GateEvidence {
  readonly path: string
  readonly line: number
  readonly quote: string
}

export interface GateVerdict {
  readonly level: GateLevel
  readonly verdict: GateVerdictValue
  readonly reason: string
  readonly evidence: readonly GateEvidence[]
  readonly cached: boolean
}

export interface GateModelPort {
  callJson(request: {
    readonly system: string
    readonly user: string
    readonly maxTokens: number
    readonly signal: AbortSignal
  }): Promise<unknown>
}

export type LadderRoute = 'merge' | 'undecided' | 'keep' | 'error'

export interface LadderResult {
  readonly route: LadderRoute
  readonly verdicts: readonly GateVerdict[]
  readonly calls: number
  readonly droppedAt?: GateLevel
  readonly error?: string
}

export class GateCache {
  private readonly entries = new Map<string, GateVerdict>()
  get(key: string): GateVerdict | undefined { return this.entries.get(key) }
  put(key: string, value: GateVerdict): void { this.entries.set(key, value) }
  get size(): number { return this.entries.size }
  toObject(): Record<string, GateVerdict> { return Object.fromEntries(this.entries) }
  static fromObject(value: unknown): GateCache {
    const cache = new GateCache()
    if (typeof value !== 'object' || value === null) return cache
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== 'object' || entry === null) continue
      const verdict = entry as Partial<GateVerdict>
      if (verdict.verdict === 1 || verdict.verdict === 0 || verdict.verdict === -1) {
        cache.put(key, { level: verdict.level === 'L0' || verdict.level === 'L1' || verdict.level === 'L2' ? verdict.level : 'L2', verdict: verdict.verdict, reason: typeof verdict.reason === 'string' ? verdict.reason : '', evidence: Array.isArray(verdict.evidence) ? verdict.evidence : [], cached: true })
      }
    }
    return cache
  }
}

export function gateCacheKey(level: GateLevel, payload: string, model: string): string {
  return createHash('sha256').update(JSON.stringify({ level, payload, model })).digest('hex')
}

function payloadFor(level: GateLevel, candidate: GateCandidate, facts: Map<string, GateFacts>): string {
  const a = facts.get(candidate.a)
  const b = facts.get(candidate.b)
  if (a === undefined || b === undefined) throw new Error('candidate names are not in the fact set')
  const base = {
    level,
    skill_a: { name: a.name, description: a.description },
    skill_b: { name: b.name, description: b.description },
    scores: { jaccard_summary: candidate.score ?? null },
    schema: { verdict: '1 | 0 | -1', reason: '<=80 chars' },
  }
  if (level === 'L0') return JSON.stringify(base)
  const withHead = {
    ...base,
    skill_a: { ...base.skill_a, head: a.body.slice(0, 2400) },
    skill_b: { ...base.skill_b, head: b.body.slice(0, 2400) },
  }
  if (level === 'L1') return JSON.stringify(withHead)
  return JSON.stringify({
    ...withHead,
    skill_a: { ...withHead.skill_a, body_excerpt: a.body.slice(0, 4000) },
    skill_b: { ...withHead.skill_b, body_excerpt: b.body.slice(0, 4000) },
  })
}

const SYSTEM = 'Judge whether two skill documents describe the same reusable capability. Shared vocabulary or a shared preamble is not duplication. Return only strict JSON: {"verdict":1|0|-1,"reason":"..."}'

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

export function parseVerdict(level: GateLevel, raw: unknown, cached = false): GateVerdict | undefined {
  const value = typeof raw === 'string' ? extractJson(raw) : raw
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { verdict?: unknown; reason?: unknown; evidence?: unknown }
  const verdict = record.verdict === 1 || record.verdict === '1' ? 1
    : record.verdict === 0 || record.verdict === '0' ? 0
      : record.verdict === -1 || record.verdict === '-1' ? -1
        : undefined
  if (verdict === undefined) return undefined
  const reason = typeof record.reason === 'string' ? record.reason.slice(0, 80) : ''
  const evidence: GateEvidence[] = Array.isArray(record.evidence)
    ? record.evidence
      .filter(item => typeof item === 'object' && item !== null)
      .map((item) => {
        const entry = item as { path?: unknown; line?: unknown; quote?: unknown }
        return { path: typeof entry.path === 'string' ? entry.path : '', line: typeof entry.line === 'number' ? entry.line : -1, quote: typeof entry.quote === 'string' ? entry.quote.slice(0, 120) : '' }
      })
    : []
  return { level, verdict, reason, evidence, cached }
}

export interface RunLadderOptions {
  readonly level: GateLevel
  readonly candidate: GateCandidate
  readonly facts: readonly GateFacts[]
  readonly model: GateModelPort
  readonly modelName: string
  readonly signal: AbortSignal
  readonly cache?: GateCache
  /** Audit path starts at L2 after an L0 keep. */
  readonly startLevel?: GateLevel
}

/** Deterministic 10% L0 audit selection from the run seed + pair key. */
export function selectedForAudit(pairKey: string, seed: string, rate = 0.1): boolean {
  const digest = createHash('sha256').update(seed + '\u0000' + pairKey).digest()
  return digest[0] !== undefined && digest[0] < Math.round(Math.max(0, Math.min(1, rate)) * 256)
}

export async function runLadder(options: RunLadderOptions): Promise<LadderResult> {
  const facts = new Map(options.facts.map(fact => [fact.name, fact]))
  const verdicts: GateVerdict[] = []
  let calls = 0
  let level: GateLevel = options.startLevel ?? 'L0'
  for (;;) {
    let payload: string
    try {
      payload = payloadFor(level, options.candidate, facts)
    } catch (error) {
      return { route: 'error', verdicts, calls, error: error instanceof Error ? error.message : String(error) }
    }
    const key = gateCacheKey(level, payload, options.modelName)
    const cached = options.cache?.get(key)
    let verdict: GateVerdict | undefined
    if (cached !== undefined) verdict = { ...cached, level, cached: true }
    else {
      try {
        calls += 1
        const raw = await options.model.callJson({ system: SYSTEM, user: payload, maxTokens: 500, signal: options.signal })
        verdict = parseVerdict(level, raw)
        if (verdict !== undefined) options.cache?.put(key, verdict)
      } catch (error) {
        return { route: 'error', verdicts, calls, error: error instanceof Error ? error.message : String(error) }
      }
    }
    if (verdict === undefined) return { route: 'error', verdicts, calls, error: 'invalid gate JSON' }
    verdicts.push(verdict)
    if (level === 'L0') {
      if (verdict.verdict === -1) return { route: 'keep', verdicts, calls, droppedAt: 'L0' }
      level = 'L1'
      continue
    }
    if (level === 'L1') {
      if (verdict.verdict === -1) return { route: 'keep', verdicts, calls, droppedAt: 'L1' }
      level = 'L2'
      continue
    }
    if (verdict.verdict === 1) return { route: 'merge', verdicts, calls }
    if (verdict.verdict === 0) return { route: 'undecided', verdicts, calls }
    return { route: 'keep', verdicts, calls, droppedAt: 'L2' }
  }
}
