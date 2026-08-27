/**
 * Deterministic validator for model-produced evolution plans.
 * The validator never calls the model and never mutates state.
 * @module @deepseek-ai/dsh-evolution-plan-validator
 */

import { DEFAULT_MAX_OPS_PER_PLAN, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_SKILL_CONTENT_CHARS, DEFAULT_USER_CHAR_LIMIT } from '@deepseek-ai/dsh-evolution-core'

export interface MemoryOp {
  target?: string
  action?: string
  facts?: string
  content?: string
  old_text?: string
  evidence?: unknown[]
}

export interface SkillOp {
  action?: string
  name?: string
  content?: string
  /** write_file payload (the tool reads `file_content`, not `content`). */
  file_content?: string
  old_string?: string
  new_string?: string
  file_path?: string
  absorbed_into?: string
  evidence?: unknown[]
}

export interface EvolutionPlan {
  memoryOps?: MemoryOp[]
  skillOps?: SkillOp[]
  summary?: string
}

export interface ValidationContext {
  /** Upper bound for the latest valid session seq. */
  sessionSeq: number
  maxOpsPerPlan?: number
  protectedSkillNames?: ReadonlySet<string>
  maxMemoryChars?: number
  maxUserChars?: number
  maxSkillContentChars?: number
}

export interface RejectedOp {
  index: number
  kind: 'memory' | 'skill'
  reason: string
}

export interface ValidationResult {
  accepted: EvolutionPlan
  rejected: RejectedOp[]
  ok: boolean
}

const MEMORY_ACTIONS = new Set(['add', 'replace', 'remove'])
const SKILL_ACTIONS = new Set(['create', 'edit', 'update', 'patch', 'delete', 'write_file', 'remove_file'])
const FORBIDDEN_KEYS = ['policy', 'threshold', 'prompt_hash', 'model_route', 'evolution_config']

function hasValidEvidence(evidence: unknown, sessionSeq: number): boolean {
  if (!Array.isArray(evidence) || evidence.length === 0) return false
  return evidence.every((item) => {
    if (!item || typeof item !== 'object') return false
    const record = item as Record<string, unknown>
    const seq = typeof record.event_seq === 'number'
      ? record.event_seq
      : typeof record.seq === 'number' ? record.seq : Number(record.event_seq)
    return Number.isInteger(seq) && seq >= 0 && seq <= sessionSeq
  })
}

export function validateEvolutionPlan(plan: EvolutionPlan, context: ValidationContext): ValidationResult {
  const maxOps = context.maxOpsPerPlan ?? DEFAULT_MAX_OPS_PER_PLAN
  const rejected: RejectedOp[] = []
  const memoryOps: MemoryOp[] = []
  const skillOps: SkillOp[] = []
  const accepted: EvolutionPlan = { memoryOps, skillOps, ...plan.summary === undefined ? {} : { summary: plan.summary } }

  const allOps = (plan.memoryOps?.length ?? 0) + (plan.skillOps?.length ?? 0)
  if (allOps === 0) {
    rejected.push({ index: 0, kind: 'memory', reason: 'plan contains no operations' })
    return { accepted, rejected, ok: false }
  }
  if (allOps > maxOps) {
    rejected.push({ index: 0, kind: 'memory', reason: `plan exceeds maxOpsPerPlan ${maxOps}` })
    return { accepted, rejected, ok: false }
  }

  for (const [index, op] of (plan.memoryOps ?? []).entries()) {
    const reason = validateMemoryOp(op, context, index)
    if (reason) rejected.push({ index, kind: 'memory', reason })
    else memoryOps.push(op)
  }

  for (const [index, op] of (plan.skillOps ?? []).entries()) {
    const reason = validateSkillOp(op, context, index)
    if (reason) rejected.push({ index, kind: 'skill', reason })
    else skillOps.push(op)
  }

  return { accepted, rejected, ok: rejected.length === 0 && (memoryOps.length + skillOps.length > 0) }
}

function validateMemoryOp(op: MemoryOp, context: ValidationContext, index: number): string | null {
  if (!hasValidEvidence(op.evidence, context.sessionSeq)) return `memory op ${index}: evidence is required and must reference a valid session seq`
  for (const key of FORBIDDEN_KEYS) if (key in op) return `memory op ${index}: forbidden field ${key}`
  if (op.target !== 'memory' && op.target !== 'user') return `memory op ${index}: target must be memory or user`
  const action = op.action ?? 'add'
  if (!MEMORY_ACTIONS.has(action)) return `memory op ${index}: unknown action ${action}`
  const text = (op.facts ?? op.content ?? '').trim()
  if (action !== 'remove' && text.length === 0) return `memory op ${index}: ${action} requires facts/content`
  if (action !== 'add' && !(op.old_text ?? '').trim()) return `memory op ${index}: ${action} requires old_text`
  const budget = op.target === 'user' ? (context.maxUserChars ?? DEFAULT_USER_CHAR_LIMIT) : (context.maxMemoryChars ?? DEFAULT_MEMORY_CHAR_LIMIT)
  if (text.length > budget) return `memory op ${index}: content exceeds ${op.target === 'user' ? 'user' : 'memory'} budget`
  return null
}

function validateSkillOp(op: SkillOp, context: ValidationContext, index: number): string | null {
  for (const key of FORBIDDEN_KEYS) if (key in op) return `skill op ${index}: forbidden field ${key}`
  const name = (op.name ?? '').trim()
  if (!name) return `skill op ${index}: name is required`
  if (context.protectedSkillNames?.has(name)) return `skill op ${index}: skill "${name}" is protected`
  if (!hasValidEvidence(op.evidence, context.sessionSeq)) return `skill op ${index}: evidence is required and must reference a valid session seq`
  const action = op.action ?? 'patch'
  if (!SKILL_ACTIONS.has(action)) return `skill op ${index}: unknown action ${action}`
  if ((action === 'create' || action === 'edit' || action === 'update') && !(op.content ?? '').trim()) {
    return `skill op ${index}: ${action} requires content`
  }
  if (action === 'patch' && !(op.old_string ?? '')) return `skill op ${index}: patch requires old_string`
  // Hermes background guard: a review pass may only DELETE into an explicit
  // absorbed_into umbrella target — a bare delete is reserved for the
  // deterministic curator channel and the user's foreground path.
  if (action === 'delete' && !(op.absorbed_into ?? '').trim()) return `skill op ${index}: delete requires absorbed_into`
  const writeContent = op.file_content ?? op.content ?? ''
  if (action === 'write_file' && !writeContent.trim()) return `skill op ${index}: write_file requires file_content`
  if (writeContent.length > (context.maxSkillContentChars ?? DEFAULT_SKILL_CONTENT_CHARS)) return `skill op ${index}: content exceeds skill budget`
  return null
}
