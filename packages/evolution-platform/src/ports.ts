/**
 * Host platform ports.
 *
 * This entry is safe to import at composition time: every module here uses
 * platform types only, and resolves the live host service through `ctx.get`
 * when a feature calls it. No host runtime value is imported here.
 */
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
