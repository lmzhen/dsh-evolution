// The ONE subagent execution path: capability probe -> restricted preset -> activation -> settle.
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '../platform/index.ts'
import type { EvolutionPlatform } from '../runtime/platform.ts'
import { ensureRestrictedPreset } from '../composition/ensure.ts'
import { probeChannelState } from './readiness.ts'
import { abortLink, createSubagentRun, textOfValue, type ActivationLike, type SubagentRun } from './run.ts'
import type {
  ChannelKind,
  ChannelOutcome,
  ChannelSpec,
  ChannelState,
  ConversationOpenSpec,
  ConversationOutcome,
  ConversationTurn,
  SubagentChannel,
} from './types.ts'

function platformOf(ctx: Context): EvolutionPlatform | undefined {
  return ctx.get('evolutionPlatform') as EvolutionPlatform | undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ActiveConversation {
  readonly childId: SessionId
  readonly run: SubagentRun
  disposed: boolean
}

export function createSubagentKernel(ctx: Context): SubagentChannel {
  let lastKind: 'reviewer' | 'maintainer' = 'reviewer'
  const active = new Map<SessionId, ActiveConversation>()
  const disposed = new Set<SessionId>()

  type Prepared =
    | {
        readonly ok: true
        readonly platform: EvolutionPlatform
        readonly subagents: NonNullable<EvolutionPlatform['ports']['subagents']>
        readonly ensured: Extract<Awaited<ReturnType<typeof ensureRestrictedPreset>>, { kind: 'ready' }>
      }
    | { readonly ok: false; readonly outcome: Extract<ChannelOutcome<never>, { kind: 'unavailable' } | { kind: 'aborted' }> }

  /**
   * The one policy/probe/preset preparation shared by run and open. Starting the
   * activation stays separate because run disposes and open keeps the handle.
   */
  async function prepare(spec: {
    readonly kind: ChannelKind
    readonly allow: readonly string[]
    readonly parent: ChannelSpec['parent']
  }): Promise<Prepared> {
    lastKind = spec.kind
    const probe = probeChannelState(ctx, spec.kind)
    if (probe.kind === 'unavailable') return { ok: false, outcome: probe }
    const platform = platformOf(ctx)
    const subagents = platform?.ports.subagents
    const presets = platform?.ports.presets
    if (platform === undefined || subagents === undefined || presets === undefined) {
      return { ok: false, outcome: { kind: 'unavailable', code: 'E-323', reason: 'subagents/agentPresets service unavailable' } }
    }
    const parentPresetId = presets.composedPreset(spec.parent.ctx)
    if (parentPresetId === undefined) {
      return { ok: false, outcome: { kind: 'unavailable', code: 'E-323', reason: 'parent preset could not be resolved' } }
    }
    const ensured = await ensureRestrictedPreset(ctx, { kind: spec.kind, parentPresetId, allow: spec.allow })
    if (ensured.kind === 'failed') {
      return { ok: false, outcome: { kind: 'unavailable', code: 'E-324', reason: ensured.reason } }
    }
    return { ok: true, platform, subagents, ensured }
  }


  type StartResult =
    | {
        readonly ok: true
        readonly run: SubagentRun
        readonly link: ReturnType<typeof abortLink>
        readonly platform: EvolutionPlatform
      }
    | { readonly ok: false; readonly outcome: Extract<ChannelOutcome<never>, { kind: 'unavailable' } | { kind: 'aborted' }> }

  /** Start one activation after the shared policy/prepare step; the caller owns its link/run. */
  async function startRun(
    spec: {
      readonly label: string
      readonly promptText: string
      readonly kind: ChannelKind
      readonly allow: readonly string[]
      readonly parent: ChannelSpec['parent']
      readonly agentOptions?: ChannelSpec['agentOptions']
      readonly maxDepth?: number
      readonly timeoutMs: number
      readonly signal?: AbortSignal
    },
    options: { readonly cwd?: string; readonly outputSchema?: unknown },
  ): Promise<StartResult> {
    const prepared = await prepare(spec)
    if (!prepared.ok) return { ok: false, outcome: prepared.outcome }
    const link = abortLink(spec.signal, spec.timeoutMs)
    try {
      const activation = await prepared.subagents.start({
        provider: 'spawn',
        label: spec.label,
        delivery: 'caller',
        parent: spec.parent,
        prompt: [{ type: 'text', text: spec.promptText }],
        agentPreset: prepared.ensured.presetId,
        ...(options.outputSchema !== undefined ? { outputSchema: options.outputSchema } : {}),
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {}),
        ...(spec.agentOptions !== undefined ? { agentOptions: spec.agentOptions } : {}),
        signal: link.controller.signal,
      }) as ActivationLike
      return { ok: true, run: createSubagentRun(ctx, spec.parent, spec.label, activation), link, platform: prepared.platform }
    } catch (error) {
      link.cleanup()
      if (link.controller.signal.aborted) return { ok: false, outcome: { kind: 'aborted' } }
      return { ok: false, outcome: { kind: 'unavailable', code: 'E-323', reason: messageOf(error) } }
    }
  }

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
      const started = await startRun(spec, spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema })
      if (!started.ok) return started.outcome
      const { run, link, platform } = started
      try {
        const result = await run.result
        let evidence: T | undefined
        if (spec.afterResult !== undefined) {
          try {
            const child = platform.ports.agents?.get(run.id)
            if (child !== undefined) evidence = spec.afterResult(child)
          } catch {
            evidence = undefined
          }
        }
        const stopReason = result.stopReason
        if (stopReason === 'completed' && result.structured !== undefined && result.structured !== null) {
          return {
            kind: 'ok',
            structured: result.structured,
            childId: run.id,
            stopReason: 'completed',
            ...(evidence !== undefined ? { evidence } : {}),
          }
        }
        if (stopReason === 'aborted') return { kind: 'aborted' }
        return {
          kind: 'no-structured',
          childId: run.id,
          stopReason,
          ...(result.diagnostic !== undefined ? { diagnostic: result.diagnostic } : {}),
          ...(evidence !== undefined ? { evidence } : {}),
        }
      } catch (error) {
        if (link.controller.signal.aborted) return { kind: 'aborted' }
        return { kind: 'unavailable', code: 'E-323', reason: messageOf(error) }
      } finally {
        link.cleanup()
        try { await run.dispose() } catch (error) {
          try { ctx.logger.warn('subagent channel: activation dispose failed: ' + messageOf(error)) } catch { /* logging must not mask teardown */ }
        }
      }
    },

    async open(spec: ConversationOpenSpec): Promise<ConversationOutcome> {
      const started = await startRun(spec, spec.cwd === undefined ? {} : { cwd: spec.cwd })
      if (!started.ok) return started.outcome
      const { run, link } = started
      try {
        const result = await run.result
        if (result.stopReason === 'aborted') {
          try { await run.dispose() } catch { /* teardown must not replace the outcome */ }
          return { kind: 'aborted' }
        }
        if (result.stopReason !== 'completed') {
          try { await run.dispose() } catch { /* teardown must not replace the outcome */ }
          return { kind: 'unavailable', code: 'E-323', reason: 'round 1 did not complete: ' + result.stopReason }
        }
        const turn: ConversationTurn = {
          childId: run.id,
          stopReason: result.stopReason,
          text: textOfValue(result.output),
          ...(result.structured !== undefined ? { structured: result.structured } : {}),
          ...(result.diagnostic !== undefined ? { diagnostic: result.diagnostic } : {}),
        }
        active.set(run.id, { childId: run.id, run, disposed: false })
        disposed.delete(run.id)
        return { kind: 'ok', childId: run.id, turn }
      } catch (error) {
        try { await run.dispose() } catch { /* teardown must not replace the outcome */ }
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
      try {
        await current.run.send([{ type: 'text', text: promptText }], options)
        const result = await current.run.next(options)
        if (result.stopReason === 'aborted') return { kind: 'aborted' }
        if (result.stopReason !== 'completed') {
          return { kind: 'unavailable', code: 'E-323', reason: 'round 2 did not complete: ' + result.stopReason }
        }
        const turn: ConversationTurn = {
          childId,
          stopReason: 'completed',
          text: textOfValue(result.output),
          ...(result.structured !== undefined ? { structured: result.structured } : {}),
          ...(result.diagnostic !== undefined ? { diagnostic: result.diagnostic } : {}),
        }
        return { kind: 'ok', childId, turn }
      } catch (error) {
        if (options?.signal?.aborted === true) return { kind: 'aborted' }
        return { kind: 'unavailable', code: 'E-323', reason: messageOf(error) }
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
        await current.run.dispose()
      } catch (error) {
        try { ctx.logger.warn('subagent conversation: dispose failed: ' + messageOf(error)) } catch { /* logging must not mask teardown */ }
      }
    },
  }
  return channel
}








