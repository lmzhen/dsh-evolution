/**
 * The resolved host port table shared by features and the adapter service.
 */
import type { AgentIdentity, AgentsPort } from './agents.ts'
import type { CommandsPort } from './commands.ts'
import type { ConnectionPort } from './connection.ts'
import type { LlmPort } from './llm.ts'
import type { ConfigEditorPort, PluginInventoryPort, PluginManagerPort } from './platformView.ts'
import type { PresetsPort } from './presets.ts'
import type { ProfileContextPort } from './profileContext.ts'
import type { ProjectionPort } from './projections.ts'
import type { SettingsPort } from './settings.ts'
import type { SkillsPort } from './skills.ts'
import type { StorageDomainPort } from './storageDomain.ts'
import type { SubagentsPort } from './subagents.ts'
import type { SystemPromptPort } from './systemPrompt.ts'
import type { ToolsPort } from './tools.ts'
import type { UserQuestionsPort } from './userQuestions.ts'
import type { WorkingDirectoryPort } from './workingDirectory.ts'

export interface HostPlatformPorts {
  readonly agents: AgentsPort | undefined
  readonly connection: ConnectionPort | undefined
  readonly settings: SettingsPort | undefined
  readonly storageDomain: StorageDomainPort | undefined
  readonly workingDirectory: WorkingDirectoryPort | undefined
  readonly pluginManager: PluginManagerPort | undefined
  readonly pluginInventory: PluginInventoryPort | undefined
  readonly configEditor: ConfigEditorPort | undefined
  readonly profileContext: ProfileContextPort | undefined
  readonly skills: SkillsPort | undefined
  readonly commands: CommandsPort | undefined
  readonly systemPrompt: SystemPromptPort | undefined
  readonly subagents: SubagentsPort | undefined
  readonly userQuestions: UserQuestionsPort | undefined
  readonly projections: ProjectionPort | undefined
  readonly llm: LlmPort | undefined
  readonly tools: ToolsPort | undefined
  readonly presets: PresetsPort | undefined
}

export type { AgentIdentity }
