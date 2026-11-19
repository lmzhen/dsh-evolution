/**
 * The family's host capability service: one place that resolves the platform
 * ports and reports which halves are available.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { CONTRACT } from '@deepseek-ai/dsh-evolution-platform-contract'
import type { AgentIdentity, HostPlatformPorts } from '@deepseek-ai/dsh-evolution-platform-contract'
import { agentsPort } from './agents.ts'
import { commandsPort } from './commands.ts'
import { settingsPort } from './settings.ts'
import { profileContextPort } from './profileContext.ts'
import { pluginManagerPort, pluginInventoryPort, configEditorPort } from './platformView.ts'
import { workingDirectoryPort } from './workingDirectory.ts'
import { skillsPort } from './skills.ts'
import { storageDomainPort } from './storageDomain.ts'
import { connectionPort } from './connection.ts'
import { systemPromptPort } from './systemPrompt.ts'
import { subagentsPort } from './subagents.ts'
import { userQuestionsPort } from './userQuestions.ts'
import { presetsPort } from './presets.ts'
import { projectionPort } from './projections.ts'
import { toolsPort } from './tools.ts'
import { llmPort } from './llm.ts'

export type { HostPlatformPorts } from '@deepseek-ai/dsh-evolution-platform-contract'

/** Domain service owning the host port table. */
export class EvolutionPlatform extends Service {
  static inject = []

  /** The family-facing contract generation this adapter implements. */
  readonly contract = CONTRACT

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
