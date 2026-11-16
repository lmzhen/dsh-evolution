/**
 * One handle over a started subagent activation: the attach point for
 * multi-turn conversations. The kernel owns policy/preset resolution; this
 * handle owns the continuation lifecycle and the end-event wait.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ContentBlock, SessionId, SubagentStopReason } from '../platform/index.ts'
import type { EvolutionPlatform } from '../runtime/platform.ts'

export interface ActivationResultLike {
  readonly output?: unknown
  readonly structured?: unknown
  readonly diagnostic?: string
  readonly stopReason: SubagentStopReason
}

export interface ActivationLike {
  readonly childId: SessionId
  readonly result: Promise<ActivationResultLike>
  dispose(): Promise<void>
}

export interface SubagentResult {
  readonly childId: SessionId
  readonly stopReason: SubagentStopReason
  readonly output?: unknown
  readonly structured?: unknown
  readonly diagnostic?: string
}

export interface SubagentTurnOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export interface SubagentRun {
  readonly id: SessionId
  readonly name: string
  readonly result: Promise<SubagentResult>
  send(prompt: readonly ContentBlock[], options?: SubagentTurnOptions): Promise<void>
  next(options?: SubagentTurnOptions): Promise<SubagentResult>
  dispose(): Promise<void>
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

export function textOfValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .filter(block => typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text')
    .map((block) => {
      const text = (block as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

export function abortLink(signal: AbortSignal | undefined, timeoutMs: number): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort(new Error('subagent turn timeout')) }, timeoutMs)
  const onAbort = (): void => { controller.abort(signal?.reason) }
  signal?.addEventListener('abort', onAbort, { once: true })
  return {
    controller,
    cleanup: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

export function waitForSubagentEnd(
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
      ? eventCtx.on('subagent/end', (info) => {
        if (info.id !== childId) return
        finish(() => { resolve(info) })
      })
      : () => {}
    const timer = setTimeout(() => {
      finish(() => { reject(new Error('timed out waiting for subagent/end: ' + childId)) })
    }, timeoutMs)
    const onAbort = (): void => {
      finish(() => { reject(signal.reason instanceof Error ? signal.reason : new Error('conversation turn aborted')) })
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

/** Wrap one started activation in the single continuation handle. */
export function createSubagentRun(
  ctx: Context,
  parent: Agent,
  name: string,
  activation: ActivationLike,
): SubagentRun {
  let disposed = false
  let pending: { readonly promise: Promise<SubagentEndInfo>; readonly cleanup: () => void; readonly controller: AbortController } | undefined
  const map = (value: ActivationResultLike & { readonly lastAssistantMessage?: unknown }): SubagentResult => {
    const output = value.output ?? value.lastAssistantMessage
    return {
      childId: activation.childId,
      stopReason: value.stopReason,
      ...(output === undefined ? {} : { output }),
      ...(value.structured === undefined ? {} : { structured: value.structured }),
      ...(value.diagnostic === undefined ? {} : { diagnostic: value.diagnostic }),
    }
  }
  const openTurn = (options?: SubagentTurnOptions): { promise: Promise<SubagentEndInfo>; cleanup: () => void; controller: AbortController } => {
    const link = abortLink(options?.signal, options?.timeoutMs ?? 120_000)
    return { promise: waitForSubagentEnd(ctx, activation.childId, link.controller.signal, options?.timeoutMs ?? 120_000), cleanup: link.cleanup, controller: link.controller }
  }

  return {
    id: activation.childId,
    name,
    result: activation.result.then(map),
    async send(prompt, options) {
      if (disposed) throw new Error('subagent run is disposed')
      const platform = ctx.get('evolutionPlatform') as EvolutionPlatform | undefined
      const send = platform?.ports.subagents?.sendMessage
      if (send === undefined) throw new Error('subagents.sendMessage unavailable')
      pending?.cleanup()
      const turn = openTurn(options)
      pending = turn
      try {
        await send(parent, activation.childId, prompt, { signal: turn.controller.signal })
      } catch (error) {
        pending = undefined
        turn.cleanup()
        throw error
      }
    },
    async next(options) {
      if (disposed) throw new Error('subagent run is disposed')
      const turn = pending ?? openTurn(options)
      pending = undefined
      try {
        const info = await turn.promise
        return map({ ...info, stopReason: info.stopReason ?? 'completed' })
      } finally {
        turn.cleanup()
      }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      pending?.cleanup()
      pending = undefined
      await activation.dispose()
    },
  }
}

