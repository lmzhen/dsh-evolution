/**
 * Host platform boundary for the evolution family (G1a).
 *
 * Feature packages import platform tool values/types from this subpath only;
 * the platform-boundary gate keeps @deepseek-ai/dsh-* imports inside core/platform.
 */
export { defineTool } from '@deepseek-ai/dsh-tools'
export type {
  ObjectJsonSchema,
  ToolDefinition,
  ToolGuard,
  ToolRestriction,
} from '@deepseek-ai/dsh-tools'
export type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
export type { PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
export { registerEvolutionTool, toolsPort } from './tools.ts'
export type { ToolsPort } from './tools.ts'
