// W5 G3-S3 test seam: legacy review fixtures provided a `subagents.start` fake. The production
// path now goes through evolution-core's Channel (0.2.1 startActivation + restricted preset), so
// this adapter exposes the SAME legacy fake through the 0.2.1 provider surface and keeps every
// existing behavior fixture (result/dispose/localAgent/timing) intact.
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
      const normalized = run.result.then((value) => {
        const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
        return { stopReason: 'completed', ...record }
      })
      // The platform settles an aborted activation's result (W5 §3). Legacy fakes may return a
      // promise that never settles; emulate the platform contract by rejecting on the request
      // signal so timeout/cancel cases keep their old observability.
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => { reject(new Error('legacy fixture aborted')) }
        if (spec.signal?.aborted === true) { onAbort(); return }
        spec.signal?.addEventListener('abort', onAbort, { once: true })
      })
      const settled = Promise.race([normalized, aborted])
      return { childId, result: settled, dispose: run.dispose }
    },
  })
  // The Channel's capability probe + restricted-preset ensure both need this service. Tests that
  // already mounted a real registry keep it (idempotent guard, same discipline as the testkit
  // fixtures); the fake registry only composes/registers definitions, it never mounts them.
  if ((ctx as unknown as { get(name: string): unknown }).get('agentPresets') === undefined) {
    ctx.provide('agentPresets', {
      readDocument: async () => PARENT_PRESET_DOC,
      register: async (definition: unknown) => { registered.push(definition); return async () => {} },
      composedPreset: () => 'standard',
    })
  }
  const lookup = (ctx as unknown as { get(name: string): unknown }).get('agents') as { get(id: string): unknown } | undefined
  if (lookup !== undefined && typeof lookup.get === 'function') {
    // The real agents service owns test parent agents; the adapter only ADDS the legacy child
    // handles at their synthetic ids so the channel's evidence window can read child sessions.
    const original = lookup.get.bind(lookup)
    lookup.get = (id: string) => (children.has(id) ? children.get(id) : original(id))
  }
  return { registered }
}
