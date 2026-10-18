// W5 G3-S3/S4 shared test seam: legacy family fixtures faked the pre-0.2.1 `subagents.start`
// service. The production path is now evolution-core's SubagentChannel (0.2.1
// getProvider/startActivation + restricted preset + outcome mapping), so this module adapts the
// SAME legacy fixture behaviour to both surfaces WITHOUT duplicating channel semantics:
//   - `legacyChannel({ start })`  -> a fake SubagentChannel for orchestrator/runtime fixtures;
//   - `provideChannel(ctx, legacy)` -> the 0.2.1 `subagents` + `agentPresets` + `agents` services
//     for tests that mount real cordis plugins (review/commands).
import type { Context } from '@deepseek-ai/cordis'

export const PARENT_PRESET_DOC = {
  agentPreset: 'standard',
  content: [
    "- id: persona",
    "  name: '@deepseek-ai/dsh-persona'",
    "- id: tool-skill",
    "  name: '@deepseek-ai/dsh-tool-skill'",
    '',
  ].join('\n'),
}

export interface LegacyRun {
  readonly result: Promise<unknown>
  dispose(): Promise<void>
  readonly localAgent?: { readonly session: unknown } | null
}

export interface LegacySubagents {
  start(kind: 'spawn', request: Record<string, unknown>): Promise<LegacyRun>
}

const AVAILABLE = {
  kind: 'available' as const,
  provider: 'spawn' as const,
  preset: { id: 'evolution-restricted-test', registered: true },
}

function normalize(value: unknown): { structured?: unknown; stopReason?: string; diagnostic?: string } {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    ...(record['structured'] === undefined ? {} : { structured: record['structured'] }),
    ...(typeof record['stopReason'] === 'string' ? { stopReason: record['stopReason'] as string } : { stopReason: 'completed' }),
    ...(typeof record['diagnostic'] === 'string' ? { diagnostic: record['diagnostic'] as string } : {}),
  }
}

/** Fake channel around a legacy `{ start }` fixture (orchestrator/runtime tests). */
export function legacyChannel(legacy: LegacySubagents) {
  let started = 0
  return {
    get state() { return AVAILABLE },
    async prepare() { return AVAILABLE },
    async run(spec: {
      readonly parent: unknown
      readonly label: string
      readonly promptText: string
      readonly kind: 'reviewer' | 'maintainer'
      readonly allow: readonly string[]
      readonly outputSchema?: unknown
      readonly agentOptions?: unknown
      readonly maxDepth?: number
      readonly timeoutMs: number
      readonly signal?: AbortSignal
    }) {
      started += 1
      const childId = 'legacy-child-' + started
      const request = {
        label: spec.label,
        prompt: [{ type: 'text', text: spec.promptText }],
        parent: spec.parent,
        ...(spec.signal === undefined ? {} : { signal: spec.signal }),
        ...(spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }),
        ...(spec.agentOptions === undefined ? {} : { agentOptions: spec.agentOptions }),
        ...(spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema }),
        timeoutMs: spec.timeoutMs,
        allow: spec.allow,
        kind: spec.kind,
      }
      const run = await legacy.start('spawn', request)
      let aborted = false
      const timer = setTimeout(() => { aborted = true; resolveAbort() }, spec.timeoutMs)
      let resolveAbort: () => void = () => {}
      const abortPromise = new Promise<void>((resolve) => { resolveAbort = resolve })
      const onAbort = (): void => { aborted = true; resolveAbort() }
      spec.signal?.addEventListener('abort', onAbort, { once: true })
      // The platform settles an aborted activation; legacy fixtures may never settle, so the
      // adapter emulates that contract (timeout/abort -> aborted outcome) before mapping.
      try {
        const settled = await Promise.race([
          run.result.then((value) => ({ done: true as const, value })),
          abortPromise.then(() => ({ done: false as const })),
        ])
        if (spec.signal?.aborted === true || aborted || settled.done === false) return { kind: 'aborted' as const }
        const record = normalize(settled.value)
        if (record.stopReason === 'aborted') return { kind: 'aborted' as const }
        if (record.structured === undefined || record.structured === null) {
          return {
            kind: 'no-structured' as const,
            childId,
            stopReason: record.stopReason ?? 'completed',
            ...(record.diagnostic === undefined ? {} : { diagnostic: record.diagnostic }),
          }
        }
        return { kind: 'ok' as const, structured: record.structured, childId, stopReason: 'completed' as const }
      } finally {
        clearTimeout(timer)
        spec.signal?.removeEventListener('abort', onAbort)
        try { await run.dispose() } catch { /* channel contract: teardown never replaces the outcome */ }
      }
    },
  }
}

/**
 * Provide the 0.2.1 services for tests that mount the real family plugins on a cordis Context.
 * The legacy `{ start }` fixture keeps driving behaviour; the service shapes make the Channel's
 * capability probe + restricted-preset ensure succeed.
 */
export function provideChannel(ctx: Context, legacy: LegacySubagents): { registered: unknown[] } {
  const registered: unknown[] = []
  const children = new Map<string, unknown>()
  let started = 0
  ctx.provide('subagents', {
    getProvider: (name: string) => name === 'spawn'
      ? { name: 'spawn', capabilities: { agentPreset: true, agentOptions: true, outputSchema: true, depthLimit: true }, inheritsParentContext: false }
      : undefined,
    startActivation: async (spec: { label?: string; request: Record<string, unknown>; signal?: AbortSignal }) => {
      started += 1
      const run = await legacy.start('spawn', { ...spec.request, label: spec.label, signal: spec.signal })
      const childId = 'legacy-child-' + started
      if (run.localAgent !== undefined && run.localAgent !== null) children.set(childId, run.localAgent)
      const normalized = run.result.then((value) => normalize(value))
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => { reject(new Error('legacy fixture aborted')) }
        if (spec.signal?.aborted === true) { onAbort(); return }
        spec.signal?.addEventListener('abort', onAbort, { once: true })
      })
      return { childId, result: Promise.race([normalized, aborted]), dispose: run.dispose }
    },
  })
  if ((ctx as unknown as { get(name: string): unknown }).get('agentPresets') === undefined) {
    ctx.provide('agentPresets', {
      readDocument: async () => PARENT_PRESET_DOC,
      register: async (definition: unknown) => { registered.push(definition); return async () => {} },
      composedPreset: () => 'standard',
    })
  }
  const lookup = (ctx as unknown as { get(name: string): unknown }).get('agents') as { get(id: string): unknown } | undefined
  if (lookup !== undefined && typeof lookup.get === 'function') {
    const original = lookup.get.bind(lookup)
    lookup.get = (id: string) => (children.has(id) ? children.get(id) : original(id))
  }
  return { registered }
}
