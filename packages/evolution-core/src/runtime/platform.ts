/**
 * The family's host capability service: one place that resolves the platform
 * ports and reports which halves are available. Feature code reads ports from
 * this service; the port modules remain the only @deepseek-ai/dsh-* importers.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
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
  readonly projections: ProjectionPort | undefined
  readonly llm: LlmPort | undefined
  readonly tools: ToolsPort | undefined
  readonly presets: PresetsPort | undefined
}

/** Domain service owning the host port table. */
export class EvolutionPlatform extends Service {
  static inject = []

  private resolved: HostPlatformPorts | undefined

  constructor(ctx: Context) {
    super(ctx, 'evolutionPlatform')
  }

  /**
   * Resolve the host ports on first use and keep that answer for the service
   * lifetime. Consumers read this one table; they never fall back to a direct
   * platform import (the second resolution D7 removed).
   */
  get ports(): HostPlatformPorts {
    return this.resolved ??= {
      projections: projectionPort(this.ctx),
      llm: llmPort(this.ctx),
      tools: toolsPort(this.ctx),
      presets: presetsPort(this.ctx),
    }
  }
}
