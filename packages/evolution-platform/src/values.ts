/**
 * Platform-provided runtime helper values.
 *
 * These are the only host values feature packages may receive from the
 * adapter besides the port functions. Kept separate from `./ports` so a
 * composition-time import of a port does not load the host runtime.
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
export { defineDomain, domainTable, DomainError } from '@deepseek-ai/dsh-storage-domain'
export { escapeText } from '@deepseek-ai/dsh-skill'
export type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
  SkillSummary,
} from '@deepseek-ai/dsh-skill'
export type { Domain } from '@deepseek-ai/dsh-storage-domain'
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
export { withFileLock } from '@deepseek-ai/dsh-atomic-write'
