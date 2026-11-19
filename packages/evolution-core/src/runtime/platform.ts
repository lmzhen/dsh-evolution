/**
 * The family's host capability service: one place that resolves the platform
 * ports and reports which halves are available. Feature code reads ports from
 * this service; the port modules remain the only @deepseek-ai/dsh-* importers.
 *
 * The table is resolved on every read. A missing optional service is not a
 * permanent capability loss: it may mount after this service initializes, and
 * the next read must see it.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentIdentity, AgentsPort } from '../platform/agents.ts'
import { agentsPort } from '../platform/agents.ts'
import { commandsPort } from '../platform/commands.ts'
import type { CommandsPort } from '../platform/commands.ts'
import { settingsPort } from '../platform/settings.ts'
import { profileContextPort } from '../platform/profileContext.ts'
import type { ProfileContextPort } from '../platform/profileContext.ts'
import { pluginManagerPort, pluginInventoryPort, configEditorPort } from '../platform/platformView.ts'
import type { PluginManagerPort, PluginInventoryPort, ConfigEditorPort } from '../platform/platformView.ts'
import { workingDirectoryPort } from '../platform/workingDirectory.ts'
import type { WorkingDirectoryPort } from '../platform/workingDirectory.ts'
import { skillsPort } from '../platform/skills.ts'
import type { SkillsPort } from '../platform/skills.ts'
import { storageDomainPort } from '../platform/storageDomain.ts'
import type { SettingsPort } from '../platform/settings.ts'
import type { StorageDomainPort } from '../platform/storageDomain.ts'
import { connectionPort } from '../platform/connection.ts'
import { systemPromptPort } from '../platform/systemPrompt.ts'
import type { ConnectionPort } from '../platform/connection.ts'
import type { SystemPromptPort } from '../platform/systemPrompt.ts'
import type { SubagentsPort } from '../platform/subagents.ts'
import { subagentsPort } from '../platform/subagents.ts'
import type { UserQuestionsPort } from '../platform/userQuestions.ts'
import { userQuestionsPort } from '../platform/userQuestions.ts'
import type { LlmPort } from '../platform/llm.ts'
import type { PresetsPort } from '../platform/presets.ts'
import { presetsPort } from '../platform/presets.ts'
import type { ProjectionPort } from '../platform/projections.ts'
import { projectionPort } from '../platform/projections.ts'
import type { ToolsPort } from '../platform/tools.ts'
import { toolsPort } from '../platform/tools.ts'
import { llmPort } from '../platform/llm.ts'

/** Resolved host ports and their availability. */
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

/** Domain service owning the host port table. */
export class EvolutionPlatform extends Service {
  static inject = []

  constructor(ctx: Context) {
    super(ctx, 'evolutionPlatform')
  }

  /**
   * Resolve the host ports now. Consumers read this one table; they never fall
   * back to a direct platform import (the second resolution D7 removed).
   * Deliberately uncached: `ctx.get` is the capability lifecycle.
   */
  get ports(): HostPlatformPorts {
    return {
      agents: agentsPort(this.ctx),
      connection: connectionPort(this.ctx),
      settings: settingsPort(this.ctx),
      storageDomain: storageDomainPort(this.ctx),
      workingDirectory: workingDirectoryPort(this.ctx),
      pluginManager: pluginManagerPort(this.ctx),
      pluginInventory: pluginInventoryPort(this.ctx),
      configEditor: configEditorPort(this.ctx),
      profileContext: profileContextPort(this.ctx),
      skills: skillsPort(this.ctx),
      commands: commandsPort(this.ctx),
      systemPrompt: systemPromptPort(this.ctx),
      subagents: subagentsPort(this.ctx),
      userQuestions: userQuestionsPort(this.ctx),
      projections: projectionPort(this.ctx),
      llm: llmPort(this.ctx),
      tools: toolsPort(this.ctx),
      presets: presetsPort(this.ctx),
    }
  }

  /** Whether an exact live root agent is available for this id. */
  isRootAgent(agent: AgentIdentity): boolean {
    return this.ports.agents?.isRoot(agent) === true
  }
}
