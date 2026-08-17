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
  reviewMemoryInterval: z.number().default(10),
  reviewSkillInterval: z.number().default(10),
  substantiveMinToolCalls: z.number().default(3),
  substantiveMinUserChars: z.number().default(200),
  substantiveMinAgentChars: z.number().default(500),
  reviewMode: z.string().default('subagent'),
  memoryReviewModel: z.string().default('deepseek-v4-flash'),
  skillReviewModel: z.string().default('deepseek-v4-pro'),
  curatorModel: z.string().default('deepseek-v4-pro'),
  memoryChars: z.number().default(2200),
  userChars: z.number().default(1375),
  skillContentChars: z.number().default(100_000),
  maxOpsPerPlan: z.number().default(32),
  curatorIntervalHours: z.number().default(168),
  staleAfterDays: z.number().default(30),
  archiveAfterDays: z.number().default(90),
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
      reviewMemoryInterval: config.reviewMemoryInterval ?? 10,
      reviewSkillInterval: config.reviewSkillInterval ?? 10,
      substantiveMinToolCalls: config.substantiveMinToolCalls ?? 3,
      substantiveMinUserChars: config.substantiveMinUserChars ?? 200,
      substantiveMinAgentChars: config.substantiveMinAgentChars ?? 500,
      reviewMode: config.reviewMode === 'inject' ? 'inject' : 'subagent',
      memoryReviewModel: config.memoryReviewModel ?? 'deepseek-v4-flash',
      skillReviewModel: config.skillReviewModel ?? 'deepseek-v4-pro',
      curatorModel: config.curatorModel ?? 'deepseek-v4-pro',
      memoryChars: config.memoryChars ?? 2200,
      userChars: config.userChars ?? 1375,
      skillContentChars: config.skillContentChars ?? 100_000,
      maxOpsPerPlan: config.maxOpsPerPlan ?? 32,
      curatorIntervalHours: config.curatorIntervalHours ?? 168,
      staleAfterDays: config.staleAfterDays ?? 30,
      archiveAfterDays: config.archiveAfterDays ?? 90,
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
