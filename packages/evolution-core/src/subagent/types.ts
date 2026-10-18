// Subagent channel contract types (frozen in W1; implementation in channel.ts/readiness.ts).
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'

export type ChannelCode = 'E-323' | 'E-324'
export type ChannelKind = 'reviewer' | 'maintainer'

export interface PresetStatus {
  readonly id: string
  readonly registered: boolean
  readonly broken?: string
}

export type ChannelState =
  | { readonly kind: 'available'; readonly provider: 'spawn'; readonly preset: PresetStatus }
  | { readonly kind: 'unavailable'; readonly code: ChannelCode; readonly reason: string }

export type ChannelOutcome<T = undefined> =
  | { readonly kind: 'ok'; readonly structured: unknown; readonly childId: SessionId; readonly stopReason: 'completed'; readonly evidence?: T }
  | { readonly kind: 'no-structured'; readonly childId?: SessionId; readonly stopReason: SubagentStopReason; readonly diagnostic?: string; readonly evidence?: T }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'unavailable'; readonly code: ChannelCode; readonly reason: string }

export interface ChannelSpec<T = undefined> {
  readonly parent: Agent
  readonly label: string
  readonly promptText: string
  readonly kind: ChannelKind
  readonly allow: readonly string[]
  readonly outputSchema?: ObjectJsonSchema
  readonly agentOptions?: AgentOptions
  readonly maxDepth?: number
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly afterResult?: (child: Agent) => T
}

export interface SubagentChannel {
  readonly state: ChannelState
  prepare(spec: Pick<ChannelSpec, 'kind' | 'allow'>): Promise<ChannelState>
  run<T = undefined>(spec: ChannelSpec<T>): Promise<ChannelOutcome<T>>
}
