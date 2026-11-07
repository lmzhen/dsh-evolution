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

/** One capability row for doctor/status consumers. */
export interface PlatformCapability {
  readonly name: 'projections' | 'llm' | 'tools' | 'presets'
  readonly available: boolean
  readonly reason?: string
}

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

  readonly ports: HostPlatformPorts

  constructor(ctx: Context) {
    super(ctx, 'evolutionPlatform')
    this.ports = {
      projections: projectionPort(ctx),
      llm: llmPort(ctx),
      tools: toolsPort(ctx),
      presets: presetsPort(ctx),
    }
  }

  /** True when the two services the runtime cannot work without are present. */
  ready(): boolean {
    return this.ports.projections !== undefined && this.ports.llm !== undefined
  }

  /** One row per optional host service; absent services stay visible, not silent. */
  capabilities(): readonly PlatformCapability[] {
    return [
      { name: 'projections', available: this.ports.projections !== undefined, ...(this.ports.projections === undefined ? { reason: 'sessionProjections unavailable' } : {}) },
      { name: 'llm', available: this.ports.llm !== undefined, ...(this.ports.llm === undefined ? { reason: 'llm unavailable' } : {}) },
      { name: 'tools', available: this.ports.tools !== undefined, ...(this.ports.tools === undefined ? { reason: 'tools unavailable' } : {}) },
      { name: 'presets', available: this.ports.presets !== undefined, ...(this.ports.presets === undefined ? { reason: 'agentPresets unavailable' } : {}) },
    ]
  }
}
