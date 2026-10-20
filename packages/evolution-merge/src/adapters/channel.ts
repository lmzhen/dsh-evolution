/**
 * Adapt the platform SubagentChannel to the merge ConversationChannelLike. The optional
 * two-turn methods are checked at call time so an older channel degrades to E-323 instead
 * of throwing a TypeError.
 */
import type { ConversationChannelLike, ChannelTurnOutcome } from '../channel-port.ts'

interface PlatformTurn {
  readonly childId: unknown
  readonly stopReason: string
  readonly text: string
}

type PlatformOutcome =
  | { readonly kind: 'ok'; readonly childId: unknown; readonly turn: PlatformTurn }
  | { readonly kind: 'unavailable'; readonly code: string; readonly reason: string }
  | { readonly kind: 'aborted' }

export interface SubagentChannelLike {
  open?(spec: {
    parent: unknown
    label: string
    promptText: string
    kind: 'reviewer' | 'maintainer'
    allow: readonly string[]
    cwd?: string
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<PlatformOutcome>
  continueTurn?(childId: string, promptText: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<PlatformOutcome>
  dispose?(childId: string): Promise<void>
}

function convert(outcome: PlatformOutcome): ChannelTurnOutcome {
  if (outcome.kind !== 'ok') return outcome
  return {
    kind: 'ok',
    childId: String(outcome.childId),
    turn: { text: outcome.turn.text, stopReason: outcome.turn.stopReason },
  }
}

export function subagentChannelAdapter(channel: SubagentChannelLike): ConversationChannelLike {
  return {
    async open(spec) {
      if (channel.open === undefined) return { kind: 'unavailable', code: 'E-323', reason: 'subagent channel has no open()' }
      return convert(await channel.open(spec))
    },
    async continueTurn(childId, promptText, options) {
      if (channel.continueTurn === undefined) return { kind: 'unavailable', code: 'E-323', reason: 'subagent channel has no continueTurn()' }
      return convert(await channel.continueTurn(childId, promptText, options))
    },
    async dispose(childId) {
      if (channel.dispose === undefined) return
      await channel.dispose(childId)
    },
  }
}
