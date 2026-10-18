// Subagent channel contract (G3 implements the lifecycle; this file freezes the shape).
import type { Context } from '@deepseek-ai/cordis'
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

// G3-S1/S2 replace the stub below with the real capability probe and activation lifecycle.
export function createSubagentChannel(_ctx: Context): SubagentChannel {
  const state: ChannelState = { kind: 'unavailable', code: 'E-323', reason: 'channel-not-implemented' }
  return {
    state,
    prepare: async () => state,
    run: async () => ({ kind: 'unavailable', code: 'E-323', reason: 'channel-not-implemented' }),
  }
}

export function subagentChannelState(_ctx: Context, kind: ChannelKind): ChannelState {
  return { kind: 'unavailable', code: 'E-323', reason: 'channel-not-implemented: ' + kind }
}
