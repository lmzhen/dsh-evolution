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
export { commandsPort } from './commands.ts'
export type { CommandsPort } from './commands.ts'
export { profileContextPort } from './profileContext.ts'
export type { ProfileContextPort } from './profileContext.ts'
export { pluginManagerPort, pluginInventoryPort, configEditorPort } from './platformView.ts'
export type { PluginManagerPort, PluginInventoryPort, ConfigEditorPort } from './platformView.ts'
export { workingDirectoryPort } from './workingDirectory.ts'
export type { WorkingDirectoryPort } from './workingDirectory.ts'
export { skillsPort } from './skills.ts'
export type { SkillsPort } from './skills.ts'
export { storageDomainPort } from './storageDomain.ts'
export type { StorageDomainPort } from './storageDomain.ts'
export { settingsPort } from './settings.ts'
export type { SettingsPort } from './settings.ts'
export { connectionPort } from './connection.ts'
export type { ConnectionPort, ConnectionRoute } from './connection.ts'
export { systemPromptPort } from './systemPrompt.ts'
export type { SystemPromptPort } from './systemPrompt.ts'
export { agentsPort } from './agents.ts'
export type { AgentIdentity, AgentsPort } from './agents.ts'
export { subagentsPort } from './subagents.ts'
export type { SubagentActivationPort, SubagentSendOptions, SubagentsPort } from './subagents.ts'
export { userQuestionsPort } from './userQuestions.ts'
export type { AskedQuestions, UserQuestion, UserQuestionOption, UserQuestionsPort } from './userQuestions.ts'
export { presetsPort } from './presets.ts'
export type { PresetDefinitionLike, PresetDocument, PresetsPort } from './presets.ts'
export { projectionPort } from './projections.ts'
export type { EvolutionProjectionDefinition, ProjectionHandleLike, ProjectionPort } from './projections.ts'
export { EvolutionLlmError, llmPort, modelRoute } from './llm.ts'
export type { EvolutionLlmFailureKind, EvolutionLlmPurpose, EvolutionLlmRequest, LlmPort, ModelRoute } from './llm.ts'
export { registerEvolutionTool, toolsPort } from './tools.ts'
export type { ToolsPort } from './tools.ts'
