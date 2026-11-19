/**
 * The subagents implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  SubagentActivationPort,
  SubagentSendOptions,
  SubagentsPort,
} from '@deepseek-ai/dsh-evolution-platform-contract'

export type {
  SubagentActivationPort,
  SubagentSendOptions,
  SubagentsPort,
} from '@deepseek-ai/dsh-evolution-platform-contract'

interface SubagentsServiceLike {
  getProvider(name: string): unknown
  startActivation(spec: unknown): Promise<SubagentActivationPort>
  sendMessage?(sender: unknown, targetId: string, content: unknown, options?: SubagentSendOptions): Promise<unknown>
}

/** Resolve the subagents port; undefined means the host has no subagents service. */
export function subagentsPort(ctx: Context): SubagentsPort | undefined {
  // platform-declaration anchor: subagents is declared in core PLATFORM_SERVICE_PROBES.
  const subagents = ctx.get('subagents') as SubagentsServiceLike | undefined
  if (subagents === undefined
    || typeof subagents.getProvider !== 'function'
    || typeof subagents.startActivation !== 'function') return undefined
  return {
    getProvider: (name) => subagents.getProvider(name),
    start: (spec) => subagents.startActivation(spec),
    ...(typeof subagents.sendMessage === 'function'
      ? { sendMessage: (sender: unknown, targetId: string, content: unknown, options?: SubagentSendOptions) => subagents.sendMessage!(sender, targetId, content, options) }
      : {}),
  }
}
