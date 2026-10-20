/**
 * Model/CLI-facing /merge command definition. The host shell registers it; this module owns
 * parsing, read-only verb dispatch and the uniform error/success envelope.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { parseMergeCommand, mergeUsage, type MergeCliCommand } from './commands.ts'
import { handleReadOnlyMergeCommand } from './read-commands.ts'

export interface MergeCommandResult {
  readonly ok: boolean
  readonly text: string
}

export interface MergeCommandContext {
  /** The invoking agent, when a command (not a route) initiated the run. */
  readonly parent?: unknown
}

export interface MergeCommandService {
  execute(command: MergeCliCommand, context?: MergeCommandContext): Promise<MergeCommandResult>
}

export interface CommandInvocationLike {
  readonly rawInput: string
  readonly agent?: unknown
}

export interface CommandResultLike {
  readonly kind: 'success' | 'error'
  readonly text: string
}

export interface MergeCommandDefinitionLike {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: CommandInvocationLike) => Promise<CommandResultLike>
}

export function createReadOnlyMergeService(io: EvolutionIoLike, home: string): MergeCommandService {
  return {
    async execute(command) {
      const text = await handleReadOnlyMergeCommand(command, io, home)
      return text === null
        ? { ok: false, text: 'merge ' + command.verb + ' 需要运行引擎（当前只挂载了只读命令）' }
        : { ok: true, text }
    },
  }
}

export function createMergeCommand(service: MergeCommandService): MergeCommandDefinitionLike {
  return {
    name: 'merge',
    description: '技能自动合并：扫描、待批准、重跑、报告与 undo',
    input: { hint: mergeUsage() },
    async handler(invocation) {
      const tokens = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
      if (tokens[0] === 'merge' || tokens[0] === '/merge') tokens.shift()
      const parsed = parseMergeCommand(tokens)
      if (!parsed.ok) return { kind: 'error', text: parsed.message }
      if (parsed.help === true) return { kind: 'success', text: mergeUsage() }
      try {
        const result = await service.execute(parsed.command, { ...(invocation.agent === undefined ? {} : { parent: invocation.agent }) })
        return { kind: result.ok ? 'success' : 'error', text: result.text }
      } catch (error) {
        return { kind: 'error', text: 'merge 命令失败：' + (error instanceof Error ? error.message : String(error)) + '\n运行 /merge status 查看状态。' }
      }
    },
  }
}
