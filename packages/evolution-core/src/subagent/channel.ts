// The ONE subagent execution path: capability probe -> restricted preset -> activation -> settle.
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { ensureRestrictedPreset } from '../composition/ensure.ts'
import { probeChannelState } from './readiness.ts'
import type { ChannelOutcome, ChannelSpec, ChannelState, SubagentChannel } from './types.ts'

interface ActivationResultLike {
  readonly output?: unknown
  readonly structured?: unknown
  readonly diagnostic?: string
  readonly stopReason: SubagentStopReason
}

interface ActivationLike {
  readonly childId: SessionId
  readonly result: Promise<ActivationResultLike>
  dispose(): Promise<void>
}

interface SubagentsServiceLike {
  getProvider(name: string): unknown
  startActivation(spec: unknown): Promise<ActivationLike>
}

interface AgentPresetsServiceLike {
  composedPreset(ctx: Context): string | undefined
}

function serviceOf<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as { get(service: string): unknown }).get(name) as T | undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSubagentChannel(ctx: Context): SubagentChannel {
  let lastKind: 'reviewer' | 'maintainer' = 'reviewer'
  const channel: SubagentChannel = {
    get state(): ChannelState {
      return probeChannelState(ctx, lastKind)
    },
    async prepare(spec): Promise<ChannelState> {
      lastKind = spec.kind
      const state = probeChannelState(ctx, spec.kind)
      if (state.kind === 'unavailable') return state
      if (spec.allow.length === 0) return { kind: 'unavailable', code: 'E-324', reason: 'allow set is empty' }
      return state
    },
    async run<T = undefined>(spec: ChannelSpec<T>): Promise<ChannelOutcome<T>> {
      lastKind = spec.kind
      const probe = probeChannelState(ctx, spec.kind)
      if (probe.kind === 'unavailable') return probe
      const subagents = serviceOf<SubagentsServiceLike>(ctx, 'subagents')
      const presets = serviceOf<AgentPresetsServiceLike>(ctx, 'agentPresets')
      if (subagents === undefined || presets === undefined) {
        return { kind: 'unavailable', code: 'E-323', reason: 'subagents/agentPresets service unavailable' }
      }
      const parentPresetId = presets.composedPreset(spec.parent.ctx)
      if (parentPresetId === undefined) {
        return { kind: 'unavailable', code: 'E-323', reason: 'parent preset could not be resolved' }
      }
      const ensured = await ensureRestrictedPreset(ctx, { kind: spec.kind, parentPresetId, allow: spec.allow })
      if (ensured.kind === 'failed') {
        return { kind: 'unavailable', code: 'E-324', reason: ensured.reason }
      }
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort(new Error('subagent timeout')) }, spec.timeoutMs)
      const onAbort = (): void => { controller.abort(spec.signal?.reason) }
      spec.signal?.addEventListener('abort', onAbort, { once: true })
      let activation: ActivationLike | undefined
      try {
        activation = await subagents.startActivation({
          provider: 'spawn',
          label: spec.label,
          delivery: 'caller',
          request: {
            parent: spec.parent,
            prompt: [{ type: 'text', text: spec.promptText }],
            agentPreset: ensured.presetId,
            ...(spec.outputSchema !== undefined ? { outputSchema: spec.outputSchema } : {}),
            ...(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {}),
            ...(spec.agentOptions !== undefined ? { agentOptions: spec.agentOptions } : {}),
          },
          signal: controller.signal,
        })
        let result: ActivationResultLike
        try {
          result = await activation.result
        } catch (error) {
          if (controller.signal.aborted) return { kind: 'aborted' }
          return { kind: 'unavailable', code: 'E-323', reason: messageOf(error) }
        }
        let evidence: T | undefined
        if (spec.afterResult !== undefined) {
          try {
            const agents = serviceOf<{ get(childId: SessionId): unknown }>(ctx, 'agents')
            const child = agents?.get(activation.childId)
            if (child !== undefined) evidence = spec.afterResult(child as never)
          } catch {
            evidence = undefined
          }
        }
        const stopReason = result.stopReason
        // W5 §3: OK requires BOTH a completed stop and a structured payload; a completed run that
        // produced nothing must stay a no-structured outcome so the business layer cannot treat an
        // empty result as a plan.
        if (stopReason === 'completed' && result.structured !== undefined && result.structured !== null) {
          return {
            kind: 'ok',
            structured: result.structured,
            childId: activation.childId,
            stopReason: 'completed',
            ...(evidence !== undefined ? { evidence } : {}),
          }
        }
        if (stopReason === 'aborted') return { kind: 'aborted' }
        return {
          kind: 'no-structured',
          childId: activation.childId,
          stopReason,
          ...(result.diagnostic !== undefined ? { diagnostic: result.diagnostic } : {}),
          ...(evidence !== undefined ? { evidence } : {}),
        }
      } catch (error) {
        if (controller.signal.aborted) return { kind: 'aborted' }
        return { kind: 'unavailable', code: 'E-323', reason: messageOf(error) }
      } finally {
        clearTimeout(timer)
        spec.signal?.removeEventListener('abort', onAbort)
        if (activation !== undefined) {
          try { await activation.dispose() } catch (error) {
            // W5 §6: teardown failures are observable but must NOT replace the captured outcome.
            try { ctx.logger.warn('subagent channel: activation dispose failed: ' + messageOf(error)) } catch { /* logging must not mask teardown */ }
          }
        }
      }
    },
  }
  return channel
}
