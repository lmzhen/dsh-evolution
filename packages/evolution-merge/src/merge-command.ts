/**
 * Model/CLI-facing /merge command definition. The host shell registers it; this module owns
 * parsing, read-only verb dispatch and the uniform error/success envelope.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { parseMergeCommand, mergeUsage, type MergeCliCommand } from './commands.ts'
import { handleReadOnlyMergeCommand } from './read-commands.ts'
import { formatMergeError } from './domain/errors.ts'

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
    return await service.execute(parsed.command, invocation?.agent === undefined ? {} : { parent: invocation.agent })
  } catch (error) {
    return { ok: false, text: formatMergeError({ kind: 'runtime', code: 'merge-command-failed', message: error instanceof Error ? error.message : String(error) }) }
  }
}

export function createMergeCommand(service: MergeCommandService): MergeCommandDefinitionLike {
  return {
    name: 'merge',
    description: '技能自动合并：扫描、待批准、重跑、报告与 undo（兼容别名；请用 /evolution merge）',
    input: { hint: mergeUsage() },
    async handler(invocation) {
      const result = await runMergeCommand(service, invocation.rawInput, invocation)
      return { kind: result.ok ? 'success' : 'error', text: result.text }
    },
  }
}
