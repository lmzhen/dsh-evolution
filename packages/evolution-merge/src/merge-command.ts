/**
 * Model/CLI-facing /merge command definition. The host shell registers it; this module owns
 * parsing, read-only verb dispatch and the uniform error/success envelope.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { parseMergeCommand, mergeUsage, type MergeCliCommand } from './commands.ts'
import { aliasRegistration } from '@deepseek-ai/dsh-evolution-commands'
import { MERGE_ALIAS_DEF, MERGE_PACKAGE_VERSION } from './command-defs.ts'
import { handleReadOnlyMergeCommand } from './read-commands.ts'
import { commandError, formatMergeError } from './domain/errors.ts'

export interface MergeCommandResult {
  readonly ok: boolean
  readonly text: string
}

export interface MergeCommandContext {
  /** The invoking agent, when a command (not a route) initiated the run. */
  readonly parent?: unknown
  /** True when the invocation carried no agent at all (the E-305 shape). */
  readonly agentless?: boolean
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
        ? { ok: false, text: formatMergeError(commandError(command.verb, 'merge-engine-required', '该命令需要合并运行时（当前只挂载了只读命令）', '安装 evolution-merge 完整行后重试；只读队列见 /evolution merge status')) }
        : { ok: true, text }
    },
  }
}

export async function runMergeCommand(
  service: MergeCommandService,
  rawInput: string,
  invocation?: { readonly agent?: unknown },
): Promise<MergeCommandResult> {
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean)
  if (tokens[0] === 'merge' || tokens[0] === '/merge' || tokens[0] === 'evolution' || tokens[0] === '/evolution') tokens.shift()
  if (tokens[0] === 'merge') tokens.shift()
  const parsed = parseMergeCommand(tokens)
  if (!parsed.ok) return { ok: false, text: parsed.message }
  if (parsed.help === true) return { ok: true, text: mergeUsage() }
  try {
    return await service.execute(parsed.command, invocation?.agent === undefined ? { agentless: true } : { parent: invocation.agent })
  } catch (error) {
    return { ok: false, text: formatMergeError(commandError('command', 'merge-command-failed', error instanceof Error ? error.message : String(error), '重试；若持续失败，运行 /evolution merge doctor 查看状态')) }
  }
}

export function createMergeCommand(service: MergeCommandService, version: string = MERGE_PACKAGE_VERSION): MergeCommandDefinitionLike | null {
  if (aliasRegistration(version, MERGE_ALIAS_DEF) === 'removed') return null
  return {
    name: 'merge',
    description: (aliasRegistration(version, MERGE_ALIAS_DEF) === 'deprecated' ? '已弃用，请用 /evolution merge。' : '') + '技能自动合并：扫描、待批准、重跑、报告与 undo（兼容别名；请用 /evolution merge）',
    input: { hint: mergeUsage() },
    async handler(invocation) {
      const result = await runMergeCommand(service, invocation.rawInput, invocation)
      return { kind: result.ok ? 'success' : 'error', text: result.text }
    },
  }
}
