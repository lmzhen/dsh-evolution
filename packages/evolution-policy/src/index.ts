/**
 * Immutable evolution policy service.
 * The policy is the control plane. Model plans may not change it.
 * @module @deepseek-ai/dsh-evolution-policy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_REVIEW_MEMORY_INTERVAL,
  DEFAULT_REVIEW_SKILL_INTERVAL,
  DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS,
  DEFAULT_SUBSTANTIVE_MIN_USER_CHARS,
  FORBIDDEN_CONTROL_KEYS,
  DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS,
  DEFAULT_MAX_OPS_PER_PLAN,
  DEFAULT_CURATOR_INTERVAL_HOURS,
  DEFAULT_STALE_AFTER_DAYS,
  EVOLUTION_WRITE_TOOLS,
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_MEMORY_CHAR_LIMIT,
  DEFAULT_USER_CHAR_LIMIT,
  DEFAULT_SKILL_CONTENT_CHARS,
  clampedNumber,
} from '@deepseek-ai/dsh-evolution-core'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionPolicy: EvolutionPolicy
  }
}

export interface PolicySnapshot {
  version: 1
  reviewMemoryInterval: number
  reviewSkillInterval: number
  substantiveMinToolCalls: number
  substantiveMinUserChars: number
  substantiveMinAgentChars: number
  reviewMode: 'subagent' | 'inject'
  memoryReviewModel: string
  skillReviewModel: string
  curatorModel: string
  memoryChars: number
  userChars: number
  skillContentChars: number
  maxOpsPerPlan: number
  curatorIntervalHours: number
  staleAfterDays: number
  archiveAfterDays: number
  protectedSkillNames: readonly string[]
}

export interface Config {
  reviewMemoryInterval?: number
  reviewSkillInterval?: number
  substantiveMinToolCalls?: number
  substantiveMinUserChars?: number
  substantiveMinAgentChars?: number
  reviewMode?: string
  memoryReviewModel?: string
  skillReviewModel?: string
  curatorModel?: string
  memoryChars?: number
  userChars?: number
  skillContentChars?: number
  maxOpsPerPlan?: number
  curatorIntervalHours?: number
  staleAfterDays?: number
  archiveAfterDays?: number
  protectedSkillNames?: string[]
}

export const Config: Schema<Config> = z.object({
  reviewMemoryInterval: z.number().min(1).default(DEFAULT_REVIEW_MEMORY_INTERVAL),
  reviewSkillInterval: z.number().min(1).default(DEFAULT_REVIEW_SKILL_INTERVAL),
  substantiveMinToolCalls: z.number().min(1).default(DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS),
  substantiveMinUserChars: z.number().min(1).default(DEFAULT_SUBSTANTIVE_MIN_USER_CHARS),
  substantiveMinAgentChars: z.number().min(1).default(DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS),
  reviewMode: z.string().default('subagent'),
  memoryReviewModel: z.string().default('deepseek-v4-flash'),
  skillReviewModel: z.string().default('deepseek-v4-pro'),
  curatorModel: z.string().default('deepseek-v4-pro'),
  memoryChars: z.number().min(1).default(DEFAULT_MEMORY_CHAR_LIMIT),
  userChars: z.number().min(1).default(DEFAULT_USER_CHAR_LIMIT),
  skillContentChars: z.number().min(1).default(DEFAULT_SKILL_CONTENT_CHARS),
  maxOpsPerPlan: z.number().min(1).default(DEFAULT_MAX_OPS_PER_PLAN),
  curatorIntervalHours: z.number().min(1).default(DEFAULT_CURATOR_INTERVAL_HOURS),
  staleAfterDays: z.number().min(1).default(DEFAULT_STALE_AFTER_DAYS),
  archiveAfterDays: z.number().min(1).default(DEFAULT_ARCHIVE_AFTER_DAYS),
  protectedSkillNames: z.array(z.string()).default([]),
})

export class EvolutionPolicy extends Service {
  static Config: Schema<Config> = Config
  readonly snapshot: PolicySnapshot

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionPolicy')
    // DSH-native monotonic guard: policy denials run after the extensible
    // pre-execute waterfall and cannot be overridden by later listeners.
    ctx.inject(['tools'], (toolCtx) => {
      const tools = toolCtx.get('tools') as {
        guard(guard: (exec: { name: string; arguments: unknown }) => string | undefined): () => void
      }
      toolCtx.effect(() => tools.guard(exec => this.guardReason(exec.name, exec.arguments)), 'evolution-policy.tools-guard')
    })
    // G3.1 (0.3.23): every numeric snapshot field is clamped to at least 1.
    // 0 / negative / NaN / ±Infinity fall back to the shared default (a 0 is
    // never a "disabled" meaning). The schema `.min(1)` rejects 0/negative at
    // config load; this clamp covers NaN/±Infinity (which schemastery lets
    // through) and any value reaching the snapshot outside the schema. Warn
    // once when a user-supplied value had to be corrected.
    const clamped: string[] = []
    const field = (name: string, value: number | undefined, fallback: number): number => {
      const result = clampedNumber(value, fallback, { min: 1 })
      if (value !== undefined && result !== value) clamped.push(name)
      return result
    }
    this.snapshot = Object.freeze({
      version: 1 as const,
      reviewMemoryInterval: field('reviewMemoryInterval', config.reviewMemoryInterval, DEFAULT_REVIEW_MEMORY_INTERVAL),
      reviewSkillInterval: field('reviewSkillInterval', config.reviewSkillInterval, DEFAULT_REVIEW_SKILL_INTERVAL),
      substantiveMinToolCalls: field('substantiveMinToolCalls', config.substantiveMinToolCalls, DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS),
      substantiveMinUserChars: field('substantiveMinUserChars', config.substantiveMinUserChars, DEFAULT_SUBSTANTIVE_MIN_USER_CHARS),
      substantiveMinAgentChars: field('substantiveMinAgentChars', config.substantiveMinAgentChars, DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS),
      reviewMode: config.reviewMode === 'inject' ? 'inject' : 'subagent',
      memoryReviewModel: config.memoryReviewModel ?? 'deepseek-v4-flash',
      skillReviewModel: config.skillReviewModel ?? 'deepseek-v4-pro',
      curatorModel: config.curatorModel ?? 'deepseek-v4-pro',
      memoryChars: field('memoryChars', config.memoryChars, DEFAULT_MEMORY_CHAR_LIMIT),
      userChars: field('userChars', config.userChars, DEFAULT_USER_CHAR_LIMIT),
      skillContentChars: field('skillContentChars', config.skillContentChars, DEFAULT_SKILL_CONTENT_CHARS),
      maxOpsPerPlan: field('maxOpsPerPlan', config.maxOpsPerPlan, DEFAULT_MAX_OPS_PER_PLAN),
      curatorIntervalHours: field('curatorIntervalHours', config.curatorIntervalHours, DEFAULT_CURATOR_INTERVAL_HOURS),
      staleAfterDays: field('staleAfterDays', config.staleAfterDays, DEFAULT_STALE_AFTER_DAYS),
      archiveAfterDays: field('archiveAfterDays', config.archiveAfterDays, DEFAULT_ARCHIVE_AFTER_DAYS),
      protectedSkillNames: Object.freeze([...new Set(['plan', ...(config.protectedSkillNames ?? [])])]),
    })
    if (clamped.length > 0) {
      ctx.logger.warn(`evolution-policy: ${clamped.join(', ')} provided an invalid value; falling back to the default`)
    }
  }

  get(): PolicySnapshot {
    return this.snapshot
  }

  guardReason(toolName: string, args: unknown): string | undefined {
    // 0.3.17 (E-28): the forbidden-key list used to be a local copy and only
    // covered the TOP-LEVEL args of a memory call — `operations[]` entries
    // (the atomic-batch shape the threat scanner already treats as real)
    // carried control-plane keys unchecked. Both fixed via the core constant
    // (S3.10) and the inner scan (E-28).
    // 0.3.20 (N-5): the write-tool set is the core single source (was a local
    // hardcoded pair that drifted from the S3.10 constant).
    if (EVOLUTION_WRITE_TOOLS.includes(toolName as (typeof EVOLUTION_WRITE_TOOLS)[number])) {
      const scan = (candidate: Record<string, unknown>): string | undefined => {
        for (const forbidden of FORBIDDEN_CONTROL_KEYS) {
          if (forbidden in candidate) return `evolution-policy: tool call may not mutate ${forbidden}`
        }
        return undefined
      }
      const record = asRecord(args)
      const top = scan(record)
      if (top) return top
      if (Array.isArray(record.operations)) {
        for (const op of record.operations) {
          const inner = scan(asRecord(op))
          if (inner) return inner
        }
      }
    }
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default EvolutionPolicy
