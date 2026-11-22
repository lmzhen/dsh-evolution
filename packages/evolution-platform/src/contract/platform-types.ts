/**
 * Platform types that appear in family port signatures and feature code.
 *
 * Type-only: this package must stay free of host runtime imports. The types
 * re-exported here are the same declarations the adapter consumes, so a
 * feature can depend on the contract for both its port interfaces and the
 * platform value shapes around them.
 */
export type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
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
export type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
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
  UserMessage,
} from '@deepseek-ai/dsh-llm'
export type { EpochHeader, Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
export type { Agent, AgentOptions, PreStepDecision } from '@deepseek-ai/dsh-agent'
export type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
