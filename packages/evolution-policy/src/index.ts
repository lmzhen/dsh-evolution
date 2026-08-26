/**
 * Immutable evolution policy service.
 * The policy is the control plane. Model plans may not change it.
 * @module @deepseek-ai/dsh-evolution-policy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { resolve, sep, join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_REVIEW_MEMORY_INTERVAL,
  DEFAULT_REVIEW_SKILL_INTERVAL,
  DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS,
  DEFAULT_SUBSTANTIVE_MIN_USER_CHARS,
  DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS,
  DEFAULT_MAX_OPS_PER_PLAN,
  DEFAULT_CURATOR_INTERVAL_HOURS,
  DEFAULT_STALE_AFTER_DAYS,
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_MEMORY_CHAR_LIMIT,
  DEFAULT_USER_CHAR_LIMIT,
  DEFAULT_SKILL_CONTENT_CHARS,
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
  protectedPaths: readonly string[]
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
  protectedPaths?: string[]
}

export const Config: Schema<Config> = z.object({
  reviewMemoryInterval: z.number().default(DEFAULT_REVIEW_MEMORY_INTERVAL),
  reviewSkillInterval: z.number().default(DEFAULT_REVIEW_SKILL_INTERVAL),
  substantiveMinToolCalls: z.number().default(DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS),
  substantiveMinUserChars: z.number().default(DEFAULT_SUBSTANTIVE_MIN_USER_CHARS),
  substantiveMinAgentChars: z.number().default(DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS),
  reviewMode: z.string().default('subagent'),
  memoryReviewModel: z.string().default('deepseek-v4-flash'),
  skillReviewModel: z.string().default('deepseek-v4-pro'),
  curatorModel: z.string().default('deepseek-v4-pro'),
  memoryChars: z.number().default(DEFAULT_MEMORY_CHAR_LIMIT),
  userChars: z.number().default(DEFAULT_USER_CHAR_LIMIT),
  skillContentChars: z.number().default(DEFAULT_SKILL_CONTENT_CHARS),
  maxOpsPerPlan: z.number().default(DEFAULT_MAX_OPS_PER_PLAN),
  curatorIntervalHours: z.number().default(DEFAULT_CURATOR_INTERVAL_HOURS),
  staleAfterDays: z.number().default(DEFAULT_STALE_AFTER_DAYS),
  archiveAfterDays: z.number().default(DEFAULT_ARCHIVE_AFTER_DAYS),
  protectedSkillNames: z.array(z.string()).default([]),
  protectedPaths: z.array(z.string()).default([]),
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
    const homePolicyPath = resolve(join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'evolution', 'policy.json'))
    this.snapshot = Object.freeze({
      version: 1 as const,
      reviewMemoryInterval: config.reviewMemoryInterval ?? DEFAULT_REVIEW_MEMORY_INTERVAL,
      reviewSkillInterval: config.reviewSkillInterval ?? DEFAULT_REVIEW_SKILL_INTERVAL,
      substantiveMinToolCalls: config.substantiveMinToolCalls ?? DEFAULT_SUBSTANTIVE_MIN_TOOL_CALLS,
      substantiveMinUserChars: config.substantiveMinUserChars ?? DEFAULT_SUBSTANTIVE_MIN_USER_CHARS,
      substantiveMinAgentChars: config.substantiveMinAgentChars ?? DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS,
      reviewMode: config.reviewMode === 'inject' ? 'inject' : 'subagent',
      memoryReviewModel: config.memoryReviewModel ?? 'deepseek-v4-flash',
      skillReviewModel: config.skillReviewModel ?? 'deepseek-v4-pro',
      curatorModel: config.curatorModel ?? 'deepseek-v4-pro',
      memoryChars: config.memoryChars ?? DEFAULT_MEMORY_CHAR_LIMIT,
      userChars: config.userChars ?? DEFAULT_USER_CHAR_LIMIT,
      skillContentChars: config.skillContentChars ?? DEFAULT_SKILL_CONTENT_CHARS,
      maxOpsPerPlan: config.maxOpsPerPlan ?? DEFAULT_MAX_OPS_PER_PLAN,
      curatorIntervalHours: config.curatorIntervalHours ?? DEFAULT_CURATOR_INTERVAL_HOURS,
      staleAfterDays: config.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
      archiveAfterDays: config.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS,
      protectedSkillNames: Object.freeze([...new Set(['plan', ...(config.protectedSkillNames ?? [])])]),
      protectedPaths: Object.freeze([...(config.protectedPaths ?? []), homePolicyPath]),
    })
  }

  get(): PolicySnapshot {
    return this.snapshot
  }

  isProtectedPath(path: unknown): boolean {
    if (typeof path !== 'string') return false
    const normalized = resolve(path)
    return this.snapshot.protectedPaths.some((prefix) => {
      const resolved = resolve(prefix)
      return normalized === resolved || normalized.startsWith(resolved + sep)
    })
  }

  guardReason(toolName: string, args: unknown): string | undefined {
    if (toolName === 'write' || toolName === 'edit' || toolName === 'patch' || toolName === 'str_replace_editor') {
      const record = asRecord(args)
      const target = record.path ?? record.file_path ?? record.filePath
      if (this.isProtectedPath(target)) return `evolution-policy: refusing to modify protected policy path ${String(target)}`
    }
    if (toolName === 'memory' || toolName === 'skill_manage') {
      const record = asRecord(args)
      for (const forbidden of ['policy', 'threshold', 'prompt_hash', 'model_route', 'evolution_config']) {
        if (forbidden in record) return `evolution-policy: tool call may not mutate ${forbidden}`
      }
    }
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default EvolutionPolicy
