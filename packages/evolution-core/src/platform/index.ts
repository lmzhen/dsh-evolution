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
export { scopeOf } from '@deepseek-ai/dsh-scope'
export { BlockAssembler, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
export type {
  ContentBlock,
  ContextFormed,
  GenerateOptions,
  Message,
  RequestMessage,
  StreamChunk,
  ToolCallBlock,
  ToolCallId,
  ToolHistory,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
export { SessionId } from '@deepseek-ai/dsh-session'
export type { EpochHeader, Session, SessionEvent } from '@deepseek-ai/dsh-session'
export type { Agent, AgentOptions, PreStepDecision } from '@deepseek-ai/dsh-agent'
export type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
export type { UserMessage } from '@deepseek-ai/dsh-llm'
export type { PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
export { presetsPort } from './presets.ts'
export type { PresetDefinitionLike, PresetDocument, PresetsPort } from './presets.ts'
export { projectionPort } from './projections.ts'
export type { EvolutionProjectionDefinition, ProjectionHandleLike, ProjectionPort } from './projections.ts'
export { EvolutionLlmError, llmPort, modelRoute } from './llm.ts'
export type { EvolutionLlmFailureKind, EvolutionLlmPurpose, EvolutionLlmRequest, LlmPort, ModelRoute } from './llm.ts'
export { registerEvolutionTool, toolsPort } from './tools.ts'
export type { ToolsPort } from './tools.ts'
