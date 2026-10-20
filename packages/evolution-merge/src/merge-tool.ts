/**
 * Model-facing merge_stage tool definition. The plugin shell supplies the context factory;
 * this module owns the argument schema and the JSON result. All policy remains in applyStageTool.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { applyStageTool, type StageToolContext, type StageToolOp, type StageToolResult } from './stage-tool.ts'

export const MERGE_STAGE_TOOL_NAME = 'merge_stage'

export interface ToolDefinitionLike {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    readonly render: (args: unknown, value: string) => readonly { readonly type: 'text'; readonly text: string }[]
  }
  readonly execute: (args: Record<string, unknown>, exec: unknown) => Promise<string>
}

function shapeError(message: string): StageToolResult {
  return { ok: false, code: 'bad-path', message }
}

function operation(args: Record<string, unknown>): StageToolOp | StageToolResult {
  const op = args.op
  if (op === 'list') {
    const area = args.area
    if (area !== 'sources' && area !== 'merged') return shapeError('list.area must be sources or merged')
    return { op, area, ...(typeof args.path === 'string' ? { path: args.path } : {}), ...(typeof args.source === 'string' ? { source: args.source } : {}) }
  }
  if (op === 'read') {
    const area = args.area
    if (area !== 'sources' && area !== 'merged') return shapeError('read.area must be sources or merged')
    if (typeof args.path !== 'string' || args.path === '') return shapeError('read.path is required')
    return { op, area, path: args.path, ...(typeof args.source === 'string' ? { source: args.source } : {}) }
  }
  if (op === 'write') {
    if (typeof args.path !== 'string' || args.path === '') return shapeError('write.path is required')
    if (typeof args.content !== 'string') return shapeError('write.content must be a string')
    return { op, path: args.path, content: args.content }
  }
  if (op === 'copy') {
    if (typeof args.source !== 'string' || typeof args.from !== 'string' || typeof args.to !== 'string') return shapeError('copy requires source/from/to')
    return { op, source: args.source, from: args.from, to: args.to }
  }
  return shapeError('op must be list/read/write/copy')
}

export function createMergeStageTool(
  io: EvolutionIoLike,
  home: string,
  context: () => StageToolContext,
): ToolDefinitionLike {
  return {
    name: MERGE_STAGE_TOOL_NAME,
    description: 'Read source copies and write the merged skill into the staging tree. Write/copy are only allowed in the author phase.',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list', 'read', 'write', 'copy'] },
        area: { type: 'string', enum: ['sources', 'merged'] },
        path: { type: 'string' },
        source: { type: 'string' },
        content: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['op'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const op = operation(args)
      if ('ok' in op) return JSON.stringify(op)
      return JSON.stringify(await applyStageTool(io, home, context(), op))
    },
  }
}
