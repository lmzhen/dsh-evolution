// The ONE subagent execution path: capability probe -> restricted preset -> activation -> settle.
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { ensureRestrictedPreset } from '../composition/ensure.ts'
import { probeChannelState } from './readiness.ts'
import type {
  ChannelOutcome,
  ChannelSpec,
  ChannelState,
  ConversationOpenSpec,
  ConversationOutcome,
  ConversationTurn,
  ConversationTurnOptions,
  SubagentChannel,
} from './types.ts'

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
  sendMessage?(sender: unknown, targetId: SessionId, content: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
}

interface SubagentEndInfo {
  readonly id?: string
  readonly stopReason?: SubagentStopReason
  readonly lastAssistantMessage?: unknown
  readonly diagnostic?: string
}

interface EventContextLike {
  on(event: 'subagent/end', listener: (info: SubagentEndInfo) => void): () => void
}

interface AgentPresetsServiceLike {
  composedPreset(ctx: Context): string | undefined
}

function serviceOf(ctx: Context, name: string): unknown {
  return (ctx as unknown as { get(service: string): unknown }).get(name)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function textOfValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .filter(block => typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text')
    .map(block => String((block as { text?: unknown }).text ?? ''))
    .join('')
}

function abortLink(signal: AbortSignal | undefined, timeoutMs: number): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('subagent turn timeout')), timeoutMs)
  const onAbort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  return {
    controller,
    cleanup: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function waitForSubagentEnd(
  ctx: Context,
  childId: SessionId,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<SubagentEndInfo> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const eventCtx = ctx as unknown as EventContextLike
    const off = typeof eventCtx.on === 'function'
      ? eventCtx.on('subagent/end', info => {
          if (info?.id !== childId) return
          finish(() => resolve(info))
        })
      : () => {}
    const timer = setTimeout(() => {
      finish(() => reject(new Error('timed out waiting for subagent/end: ' + childId)))
    }, timeoutMs)
    const onAbort = (): void => {
      finish(() => reject(signal.reason instanceof Error ? signal.reason : new Error('conversation turn aborted')))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    function cleanup(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      off()
    }
    if (signal.aborted) onAbort()
  })
}

interface ActiveConversation {
  readonly childId: SessionId
  readonly parent: ChannelSpec['parent']
  readonly activation: ActivationLike
  disposed: boolean
}

export function createSubagentChannel(ctx: Context): SubagentChannel {
  let lastKind: 'reviewer' | 'maintainer' = 'reviewer'
  const active = new Map<SessionId, ActiveConversation>()
  const disposed = new Set<SessionId>()
  const channel: SubagentChannel = {
    get state(): ChannelState {
      return probeChannelState(ctx, lastKind)
    },
    prepare(spec): Promise<ChannelState> {
      lastKind = spec.kind
      const state = probeChannelState(ctx, spec.kind)
      if (state.kind === 'unavailable') return Promise.resolve(state)
      if (spec.allow.length === 0) return Promise.resolve({ kind: 'unavailable', code: 'E-324', reason: 'allow set is empty' })
      return Promise.resolve(state)
    },
    async run<T = undefined>(spec: ChannelSpec<T>): Promise<ChannelOutcome<T>> {
      lastKind = spec.kind
      const probe = probeChannelState(ctx, spec.kind)
      if (probe.kind === 'unavailable') return probe
      const subagents = serviceOf(ctx, 'subagents') as SubagentsServiceLike | undefined
      const presets = serviceOf(ctx, 'agentPresets') as AgentPresetsServiceLike | undefined
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
            const agents = serviceOf(ctx, 'agents') as { get(childId: SessionId): unknown } | undefined
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

    async open(spec: ConversationOpenSpec): Promise<ConversationOutcome> {
      lastKind = spec.kind
      const probe = probeChannelState(ctx, spec.kind)
      if (probe.kind === 'unavailable') return probe
      if (spec.allow.length === 0) return { kind: 'unavailable', code: 'E-324', reason: 'allow set is empty' }
      const subagents = serviceOf(ctx, 'subagents') as SubagentsServiceLike | undefined
      const presets = serviceOf(ctx, 'agentPresets') as AgentPresetsServiceLike | undefined
      if (subagents === undefined || presets === undefined) {
        return { kind: 'unavailable', code: 'E-323', reason: 'subagents/agentPresets service unavailable' }
      }
      const parentPresetId = presets.composedPreset(spec.parent.ctx)
      if (parentPresetId === undefined) {
        return { kind: 'unavailable', code: 'E-323', reason: 'parent preset could not be resolved' }
      }
      const ensured = await ensureRestrictedPreset(ctx, { kind: spec.kind, parentPresetId, allow: spec.allow })
      if (ensured.kind === 'failed') return { kind: 'unavailable', code: 'E-324', reason: ensured.reason }

      const link = abortLink(spec.signal, spec.timeoutMs)
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
            ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
            ...(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {}),
            ...(spec.agentOptions !== undefined ? { agentOptions: spec.agentOptions } : {}),
          },
          signal: link.controller.signal,
        })
        const result = await activation.result
        if (result.stopReason === 'aborted') {
          try { await activation.dispose() } catch { /* teardown must not replace the outcome */ }
          return { kind: 'aborted' }
        }
        if (result.stopReason !== 'completed') {
          try { await activation.dispose() } catch { /* teardown must not replace the outcome */ }
          return { kind: 'unavailable', code: 'E-323', reason: 'round 1 did not complete: ' + result.stopReason }
        }
        const turn: ConversationTurn = {
          childId: activation.childId,
          stopReason: result.stopReason,
          text: textOfValue(result.output),
          ...(result.structured !== undefined ? { structured: result.structured } : {}),
          ...(result.diagnostic !== undefined ? { diagnostic: result.diagnostic } : {}),
        }
        active.set(activation.childId, { childId: activation.childId, parent: spec.parent, activation, disposed: false })
        disposed.delete(activation.childId)
        return { kind: 'ok', childId: activation.childId, turn }
      } catch (error) {
        if (activation !== undefined) {
          try { await activation.dispose() } catch { /* teardown must not replace the outcome */ }
        }
        if (link.controller.signal.aborted) return { kind: 'aborted' }
        return { kind: 'unavailable', code: 'E-323', reason: messageOf(error) }
      } finally {
        link.cleanup()
      }
    },

    async continueTurn(childId, promptText, options): Promise<ConversationOutcome> {
      if (disposed.has(childId)) return { kind: 'unavailable', code: 'E-324', reason: 'conversation is disposed' }
      const current = active.get(childId)
      if (current === undefined || current.disposed) {
        return { kind: 'unavailable', code: 'E-323', reason: 'no open conversation for ' + childId }
      }
      const subagents = serviceOf(ctx, 'subagents') as SubagentsServiceLike | undefined
      if (subagents?.sendMessage === undefined) {
        return { kind: 'unavailable', code: 'E-323', reason: 'subagents.sendMessage unavailable' }
      }
      const link = abortLink(options?.signal, options?.timeoutMs ?? 120_000)
      let pending: Promise<SubagentEndInfo>
      try {
        pending = waitForSubagentEnd(ctx, childId, link.controller.signal, options?.timeoutMs ?? 120_000)
        await subagents.sendMessage(
          current.parent,
          childId,
          [{ type: 'text', text: promptText }],
          { signal: link.controller.signal },
        )
      } catch (error) {
        link.cleanup()
        if (options?.signal?.aborted === true) return { kind: 'aborted' }
        return { kind: 'unavailable', code: 'E-323', reason: messageOf(error) }
      }
      try {
        const info = await pending
        if (info.stopReason === 'aborted') return { kind: 'aborted' }
        const turn: ConversationTurn = {
          childId,
          stopReason: info.stopReason ?? 'completed',
          text: textOfValue(info.lastAssistantMessage),
          ...(info.diagnostic !== undefined ? { diagnostic: info.diagnostic } : {}),
        }
        return { kind: 'ok', childId, turn }
      } catch (error) {
        if (options?.signal?.aborted === true) return { kind: 'aborted' }
        return { kind: 'unavailable', code: 'E-323', reason: messageOf(error) }
      } finally {
        link.cleanup()
      }
    },

    async dispose(childId) {
      const current = active.get(childId)
      if (current === undefined || current.disposed) {
        disposed.add(childId)
        return
      }
      current.disposed = true
      active.delete(childId)
      disposed.add(childId)
      try {
        await current.activation.dispose()
      } catch (error) {
        try { ctx.logger.warn('subagent conversation: dispose failed: ' + messageOf(error)) } catch { /* logging must not mask teardown */ }
      }
    },
  }
  return channel
}
