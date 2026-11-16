/**
 * The subagents half of the family's host platform boundary.
 *
 * Platform versions differ in the activation-spec shape. This port keeps one
 * family-facing entry (`start`) and one activation face; the platform-specific
 * shape lives in `startActivationSpec` until the version adapter replaces the
 * temporary dual-shape bridge.
 */
import type { Context } from '@deepseek-ai/cordis'

export interface SubagentActivationPort {
  readonly childId: string
  readonly result: Promise<unknown>
  dispose(): Promise<void>
}

export interface SubagentSendOptions {
  readonly signal?: AbortSignal
}

export interface SubagentsPort {
  getProvider(name: string): unknown
  start(spec: unknown): Promise<SubagentActivationPort>
  sendMessage?(sender: unknown, targetId: string, content: unknown, options?: SubagentSendOptions): Promise<unknown>
}

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
