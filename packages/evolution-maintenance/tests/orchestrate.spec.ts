import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { renderMaintainTemplate, runMaintain, type MaintainRuntime, type SubagentResultLike, type SubagentRunLike, type SubagentStartRequestLike } from '../src/index.ts'
import { MAINTAIN_OUTPUT_INSTRUCTION, MAINTAIN_PROMPT, DRIFT_SIGNAL_NOUNS, PROMPT_BUNDLE } from '@deepseek-ai/dsh-evolution-core'

/** I-5 (v37): a minimal platform Agent stand-in — the tightened MaintainRuntime.parent
 * now requires one, and the orchestrator only forwards it to the spawn request. */
function maintAgent(): Agent {
  return { id: 'maintain-parent', session: { id: 'maintain-parent' } } as unknown as Agent
}

/** I-5 (v37): the platform SubagentRun contract — `dispose` is required, so every stub
 * returns one through this helper instead of a bare { result }. */
function runStub(result: unknown): SubagentRunLike {
  // The stub carries extra fields (text) the real platform result also has, so the
  // value crosses one unknown boundary instead of a wide index signature on the
  // contract type (which would stop the REAL platform result from assigning).
  return { result: Promise.resolve(result) as Promise<SubagentResultLike>, dispose: async () => {} }
}

/** A spawner that must never be reached (the empty-library short-circuits), typed as
 * the platform start so a stub with a missing handle fails here instead of passing. */
function neverStart(): (kind: 'spawn', options: unknown) => Promise<SubagentRunLike> {
  return (_kind, _options) => Promise.reject(new Error('should not be called'))
}

function fakeLibrary() {
  return {
    async list() {
      return [{ name: 'clean-skill' }, { name: 'fix-alignment-bad' }]
    },
    async read(name: string) {
      if (name === 'clean-skill') return '# A\n\n## When to Use\n\n- x\n'
      return '# x\n\n## A\n\n## A\n\n' + 'y'.repeat(2_500)
    },
  }
}

const validResult = {
  verdict: 'issues',
  plan: [
    {
      kind: 'skill-level',
      names: ['fix-alignment-bad'],
      rule: 'B3',
      // E1 (0.3.58): §3 completeness — this fixture's skill reports THREE over
      // signals (dup_heading / overlong_line / narrow_name; computed from the
      // fakeLibrary body) and a compliant plan must cover them all in evidence
      // (or name them in notes).
      evidence: [
        { signal: 'dup_heading', value: 'A(2)' },
        { signal: 'overlong_line', value: '7:2500' },
        { signal: 'narrow_name', value: 'session-verb' },
      ],
      finding: 'dup_heading=over: A(2)',
      recommendation: 'patch: 删除重复标题行（执行形态：skill_manage patch）',
      semantic_reasoning: '双份标题为笔误形态',
      impact: 'better',
      impact_reason: '消除重复',
      reversibility: 'patch',
      undo_path: '备份恢复',
      confidence: 0.8,
      needs_human: false,
      is_override: false,
    },
  ],
  notes: [],
}

describe('runMaintain', () => {
  function runtime(result: unknown): MaintainRuntime {
    return {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          void options
          // Platform contract: the subagent channel wraps its output as
          // `{ structured }` (review precedent, evolution-review:254-262).
          return runStub({ text: 'x', structured: result })
        },
      },
    }
  }

  it('assembles facts, spawns the subagent and renders a displayable plan', async () => {
    const outcome = await runMaintain(runtime(validResult))
    expect(outcome.ok).toBe(true)
    expect(outcome.verdict).toBe('issues')
    expect(outcome.runId).toBeTruthy()
    expect(outcome.text ?? '').toContain('Maintenance scan')
    expect(outcome.text ?? '').toContain('[skill-level] fix-alignment-bad')
    expect(outcome.text ?? '').toContain('patch: 删除重复标题行')
  })

  it('fails closed when the subagent returns no structured payload', async () => {
    const empty: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start() {
          return runStub({ text: 'nothing here' })
        },
      },
    }
    const outcome = await runMaintain(empty)
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('no structured plan')
  })

  it('short-circuits an empty library without spending a model call', async () => {
    const emptyLibrary: MaintainRuntime = {
      library: { async list() { return [] }, async read() { return undefined } },
      subagents: { start: neverStart() },
      parent: maintAgent(),
    }
    const outcome = await runMaintain(emptyLibrary)
    expect(outcome.ok).toBe(true)
    expect(outcome.verdict).toBe('no_issues')
    expect(outcome.text ?? '').toContain('empty skill library')
  })

  it('fails closed when the validator rejects the plan', async () => {
    const bad = {
      verdict: 'issues',
      plan: [{ kind: 'skill-level', names: [], rule: 'X', evidence: [{ signal: 'ghost', value: 'v' }] }],
      notes: [],
    }
    const outcome = await runMaintain(runtime(bad))
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('rejected')
  })

  it('reports subagent failure without throwing', async () => {
    const failing: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start() {
          return runStub(Promise.reject(new Error('spawn bum')))
        },
      },
    }
    const outcome = await runMaintain(failing)
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('spawn bum')
  })

  it('translates an AbortError into a readable message (0.3.3)', async () => {
    const aborting: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start() {
          const abort = new Error('This operation was aborted')
          abort.name = 'AbortError'
          return runStub(Promise.reject(abort))
        },
      },
    }
    const outcome = await runMaintain(aborting)
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('aborted')
    expect(outcome.error ?? '').not.toContain('This operation was aborted')
  })

  it('translates a plain Error with the abort message (0.3.8, command-retry cancellation shape)', async () => {
    const aborting: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start() {
          return runStub(Promise.reject(new Error('This operation was aborted')))
        },
      },
    }
    const outcome = await runMaintain(aborting)
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('aborted')
    expect(outcome.error ?? '').not.toContain('This operation was aborted')
  })

  it('distinguishes a cancelled settle (stopReason=aborted) from a missing plan (0.3.8)', async () => {
    const cancelled: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start() {
          return runStub({ text: 'x', stopReason: 'aborted' })
        },
      },
    }
    const outcome = await runMaintain(cancelled)
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('aborted')
  })

  it('passes the caller-specified timeout to the subagent start (0.3.3)', async () => {
    let capturedOptions: { signal?: AbortSignal } | undefined
    const runtimeWithTimeout: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          capturedOptions = options
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    const outcome = await runMaintain(runtimeWithTimeout, { timeoutMs: 240_000 })
    expect(outcome.ok).toBe(true)
    // AbortSignal.timeout(240_000) — the deadline rides the signal.
    expect(capturedOptions?.signal).toBeTruthy()
  })

  it('V6-29: a timeout above the AbortSignal domain is rejected explicitly, never spawned (0.3.36)', async () => {
    const never: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start() {
          throw new Error('should not be reached')
        },
      },
    }
    // AbortSignal.timeout throws a synchronous RangeError above 2^32-1; the
    // guard rejects the value up front with a readable message.
    // P2-10 (v19): the ceiling is the 32-bit SIGNED limit — [2^31, 2^32-1]
    // does not throw, it warns and silently becomes 1ms.
    const outcome = await runMaintain(never, { timeoutMs: 5_000_000_000 })
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('--timeout must be a positive integer')
    expect(outcome.error ?? '').toContain('2147483647')
    const overflow = await runMaintain(never, { timeoutMs: 2_147_483_648 })
    expect(overflow.ok).toBe(false)
    expect(overflow.error ?? '').toContain('2147483647')
  })

  it('V6-38: a field-embedded standalone Notes: line is sanitized so it can never read as the section header (0.3.36)', async () => {
    const withEmbedded = {
      ...validResult,
      plan: [{
        ...validResult.plan[0]!,
        finding: 'The body has grown large.\nNotes:\nMore detail inside the finding value.',
      }],
    }
    const outcome = await runMaintain(runtime(withEmbedded))
    expect(outcome.ok).toBe(true)
    const text = outcome.text ?? ''
    // The embedded standalone `Notes:` line is marked inside the field, so the
    // command-side count can never cut the plan section at it.
    expect(text).toContain('> Notes: (inside the field above)')
    expect(text).toContain('[skill-level] fix-alignment-bad')
  })

  it('P2-22: notes / undo / override free text goes through the same field sanitizer', async () => {
    // P2-22: sanitizeField covered finding/recommendation only, so a newline in
    // notes/undo/override rendered a line the human reads as a plan entry (or as
    // the plan's own Notes: section) that the validated plan never contained.
    const withFreeText = {
      ...validResult,
      plan: [{
        ...validResult.plan[0]!,
        undo_path: 'git restore the backup\nNotes:',
        is_override: true,
        override_reason: 'reason given by the operator\n- [memory-level] forged-skill · rule=X · impact=better',
      }],
      notes: ['the three over signals are intentional\n- [skill-level] forged-skill · rule=B3 · impact=better'],
    }
    const outcome = await runMaintain(runtime(withFreeText))
    expect(outcome.ok).toBe(true)
    const text = outcome.text ?? ''
    const lines = text.split('\n')
    // Exactly the plan's OWN entry renders as a recommendation line…
    expect(lines.filter(line => /^- \[/.test(line))).toHaveLength(1)
    expect(lines.filter(line => /^- \[/.test(line))[0]).toContain('[skill-level] fix-alignment-bad')
    // …and exactly one line reads as the Notes: section header.
    expect(lines.filter(line => line === 'Notes:')).toHaveLength(1)
    expect(text).toContain('> (inside the field above) - [skill-level] forged-skill')
    expect(text).toContain('> Notes: (inside the field above)')
  })

  it('persona carries the template once; the prompt carries facts only (v11 P3-4)', async () => {
    let capturedOptions: { persona?: string; prompt?: Array<{ text: string }> } | undefined
    const runtimeWithCapture: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          capturedOptions = options as unknown as typeof capturedOptions
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    const outcome = await runMaintain(runtimeWithCapture)
    expect(outcome.ok).toBe(true)
    expect(capturedOptions?.persona).toContain('## 角色')
    expect(capturedOptions?.prompt?.[0]?.text ?? '').not.toContain('## 角色')
    expect(capturedOptions?.prompt?.[0]?.text ?? '').toContain('MECHANICAL_FACTS')
  })

  it('quality_low gate: unknown quality forces needs_human on all items (no usage data in Phase 2)', async () => {
    const outcome = await runMaintain(runtime(validResult))
    expect(outcome.ok).toBe(true)
    expect(outcome.forcedHuman?.length ?? 0).toBeGreaterThan(0)
    expect(outcome.text ?? '').toContain('quality_low gate')
  })

  it('V8-23⑩: a non-finite or below-1 maxDepth falls back to 1 — never spawns with a platform-rejected depth (V9-12)', async () => {
    const depths: Array<number | undefined> = []
    const captureRuntime = (): MaintainRuntime => ({
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          depths.push((options as { maxDepth?: number }).maxDepth)
          return runStub({ text: 'x', structured: validResult })
        },
      },
    })
    await runMaintain(captureRuntime(), { maxDepth: Number.NaN })
    await runMaintain(captureRuntime(), { maxDepth: Number.POSITIVE_INFINITY })
    await runMaintain(captureRuntime(), { maxDepth: 0 })
    await runMaintain(captureRuntime(), { maxDepth: -2 })
    // NaN/Infinity/0/negative all fold to the documented default 1 (a
    // negative depth passes `Number.isFinite` — the guard must still reject it).
    expect(depths).toEqual([1, 1, 1, 1])
    // A valid depth passes through untouched.
    await runMaintain(captureRuntime(), { maxDepth: 4 })
    expect(depths[4]).toBe(4)
  })

  it('routes the subagent model off evolutionPolicy.curatorModel (E-55)', async () => {
    let capturedOptions: { agentOptions?: Record<string, string> } | undefined
    const runtimeWithPolicy: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      evolutionPolicy: { get() { return { curatorModel: 'policy-curator-model' } } },
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          capturedOptions = options
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    const outcome = await runMaintain(runtimeWithPolicy)
    expect(outcome.ok).toBe(true)
    expect(capturedOptions?.agentOptions?.model).toBe('policy-curator-model')
  })

  it('falls back to the default model when no policy service is mounted (E-55)', async () => {
    let capturedOptions: { agentOptions?: Record<string, string> } | undefined
    const runtimeDefault: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          capturedOptions = options
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    const outcome = await runMaintain(runtimeDefault)
    expect(outcome.ok).toBe(true)
    expect(capturedOptions?.agentOptions?.model).toBe('deepseek-v4-pro')
  })

  it('outputSchema required aligns with the validator contract (E-56)', async () => {
    let capturedOutputSchema: { required?: string[]; properties?: { plan?: { items?: { required?: string[] } } } } | undefined
    const runtimeWithSchema: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          const opts = options as { outputSchema?: typeof capturedOutputSchema }
          capturedOutputSchema = opts.outputSchema
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    const outcome = await runMaintain(runtimeWithSchema)
    expect(outcome.ok).toBe(true)
    // Root contract: the validator requires verdict/plan/notes.
    expect(capturedOutputSchema?.required).toEqual(['verdict', 'plan', 'notes'])
    const planRequired = capturedOutputSchema?.properties?.plan?.items?.required
    // The plan-item set follows validate-plan.ts's validation set. R3 (audit):
    // undo_path is DELIBERATELY not required — E-56 lets irreversible items
    // omit it and the validator normalizes 'n/a'; the schema used to demand
    // it unconditionally, so a legal no-undo plan died at the generic schema
    // gate before the validator could speak.
    expect(planRequired).toEqual(expect.arrayContaining([
      'kind', 'names', 'rule', 'evidence', 'finding', 'recommendation', 'semantic_reasoning',
      'impact', 'impact_reason', 'reversibility', 'confidence', 'needs_human', 'is_override',
    ]))
    expect(planRequired).not.toContain('undo_path')
    // override_reason is conditionally required (only when is_override), so it
    // stays OUT of the static schema list while the validator enforces it.
    expect(planRequired).not.toContain('override_reason')
  })

  it('disposes the subagent run on the success path (G4.1)', async () => {
    let disposed = 0
    const okRuntime: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start() {
          return { result: runStub({ text: 'x', structured: validResult }).result, dispose: async () => { disposed += 1 } }
        },
      },
    }
    const outcome = await runMaintain(okRuntime)
    expect(outcome.ok).toBe(true)
    expect(disposed).toBe(1)
  })

  it('warns on dispose failure without masking the success outcome (G4.1)', async () => {
    const warns: string[] = []
    const failingDisposeRuntime: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      logger: { warn: (message: string) => { warns.push(message) } },
      subagents: {
        async start() {
          return { result: runStub({ text: 'x', structured: validResult }).result, dispose: async () => { throw new Error('dispose boom') } }
        },
      },
    }
    const outcome = await runMaintain(failingDisposeRuntime)
    expect(outcome.ok).toBe(true)
    expect(outcome.verdict).toBe('issues')
    expect(warns).toHaveLength(1)
    expect(warns[0] ?? '').toContain('dispose failed')
    expect(warns[0] ?? '').toContain('dispose boom')
  })

  it('I-5: the spawn request carries the platform Agent as parent and the run is always disposed', async () => {
    const parent = maintAgent()
    let captured: { parent?: unknown } | undefined
    let disposed = 0
    const runtimeI5: MaintainRuntime = {
      library: fakeLibrary(),
      parent,
      subagents: {
        async start(_kind: 'spawn', options) {
          captured = options
          return { result: Promise.reject(new Error('spawn bum')), dispose: async () => { disposed += 1 } }
        },
      },
    }
    const outcome = await runMaintain(runtimeI5)
    expect(outcome.ok).toBe(false)
    // The platform derives workspace/lineage/depth from parent.session — I-5 made the
    // field required in the local contract, so a future omission is a compile error.
    expect(captured?.parent).toBe(parent)
    // dispose() is required by the platform handle: the rejected result still disposes once.
    expect(disposed).toBe(1)
    // A rejection the orchestrator already handled must not surface as an unhandled
    // rejection (the pre-I-5 stub returned a bare { result }, so nothing awaited it).
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    await new Promise(resolve => setTimeout(resolve, 0))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toEqual([])
  })

  // I-5 (v37): the tightened contract is enforced at COMPILE time by the harness's
  // own wiring (an incomplete stub no longer satisfies MaintainRuntime — that is how
  // this round's tsc run found the 25 stale stubs). The runtime half is pinned here:
  // dispose comes from the required handle and runs on a REJECTED result too, so a
  // future `run.dispose?.()` cannot silently stop awaiting it.
  it('I-5: a rejected subagent result still disposes the required handle exactly once', async () => {
    let disposed = 0
    let observed: SubagentRunLike | undefined
    const rejecting: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start() {
          observed = { result: Promise.reject(new Error('spawn bum')), dispose: async () => { disposed += 1 } }
          return observed
        },
      },
    }
    const outcome = await runMaintain(rejecting)
    expect(outcome.ok).toBe(false)
    expect(observed).toBeDefined()
    // The handle is the platform's: dispose exists (typed required) and is awaited.
    expect(typeof observed!.dispose).toBe('function')
    expect(disposed).toBe(1)
  })

  // F-02: the default toolFilter names `maintenance_probe`, a tool
  // registered by the host bundle's tools row — a cross-package coupling. The
  // orchestrator soft-probes the registry before the spawn and degrades to
  // `skill`-only when the tool is absent, instead of failing the spawn.
  it('F-02: an unregistered maintenance_probe degrades the toolFilter to skill and declares it', async () => {
    let captured: { toolFilter?: { allow?: string[] }; prompt?: Array<{ text: string }> } | undefined
    const runtimeNoTools: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          captured = options as unknown as typeof captured
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    // No tools accessor at all (tools service not mounted) — same degradation.
    const outcome = await runMaintain(runtimeNoTools)
    expect(outcome.ok).toBe(true)
    expect(captured?.toolFilter?.allow).toEqual(['skill'])
    const promptText = captured?.prompt?.[0]?.text ?? ''
    expect(promptText).toContain('maintenance_probe is not registered')
    expect(promptText).toContain('degrades to the `skill` tool only')
    // A registry accessor that answers "absent" degrades identically.
    const runtimeEmptyRegistry: MaintainRuntime = {
      ...runtimeNoTools,
      tools: { get: () => undefined },
    }
    await runMaintain(runtimeEmptyRegistry)
    expect(captured?.toolFilter?.allow).toEqual(['skill'])
  })

  it('F-02: a registered maintenance_probe keeps the two-tool default and adds no degradation note', async () => {
    let captured: { toolFilter?: { allow?: string[] }; prompt?: Array<{ text: string }> } | undefined
    const runtimeWithProbe: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      tools: { get: (name: string) => name === 'maintenance_probe' ? { name } : undefined },
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          captured = options as unknown as typeof captured
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    const outcome = await runMaintain(runtimeWithProbe)
    expect(outcome.ok).toBe(true)
    expect(captured?.toolFilter?.allow).toEqual(['skill', 'maintenance_probe'])
    expect(captured?.prompt?.[0]?.text ?? '').not.toContain('not registered')
  })

  it('F-02: an explicit toolAllow option is an informed override — passed through untouched', async () => {
    let captured: { toolFilter?: { allow?: string[] } } | undefined
    const runtimeOverride: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      // Even a registry WITHOUT the probe must not rewrite a caller-provided
      // filter.
      tools: { get: () => undefined },
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          captured = options as unknown as typeof captured
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    const outcome = await runMaintain(runtimeOverride, { toolAllow: ['skill', 'bash'] })
    expect(outcome.ok).toBe(true)
    expect(captured?.toolFilter?.allow).toEqual(['skill', 'bash'])
  })

  // V10-09 (F-05): the recommendation count travels as a structured outcome
  // field — consumers must never parse the rendered text again.
  it('V10-09 (F-05): outcome.recommendationCount is the validated plan length, 0 otherwise', async () => {
    const success = await runMaintain(runtime(validResult))
    expect(success.ok).toBe(true)
    expect(success.recommendationCount).toBe(1)
    // V24-19 (v24): a no_issues verdict over over-signals now requires notes
    // naming each signal — the fixture library reports three over signals, so
    // the no-action output must explain them instead of passing silently.
    const none = await runMaintain(runtime({
      verdict: 'no_issues',
      plan: [],
      notes: [
        'dup_heading / overlong_line / narrow_name: the fixture library is intentionally malformed; nothing to do',
      ],
    }))
    expect(none.ok).toBe(true)
    expect(none.recommendationCount).toBe(0)
    // Every failure path carries the field too (0) — no `undefined` leaks.
    const rejected = await runMaintain(runtime({ verdict: 'issues', plan: [{ kind: 'skill-level', names: [], rule: 'X', evidence: [{ signal: 'ghost', value: 'v' }] }], notes: [] }))
    expect(rejected.ok).toBe(false)
    expect(rejected.recommendationCount).toBe(0)
    const noPlan = await runMaintain({
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: { async start() { return runStub({ text: 'nothing here' }) } },
    })
    expect(noPlan.ok).toBe(false)
    expect(noPlan.recommendationCount).toBe(0)
    const emptyLibrary = await runMaintain({
      library: { async list() { return [] }, async read() { return undefined } },
      subagents: { start: neverStart() },
      parent: maintAgent(),
    })
    expect(emptyLibrary.ok).toBe(true)
    expect(emptyLibrary.recommendationCount).toBe(0)
  })

  it('V27 M-01: a no_issues verdict still renders the notes the validator demanded', async () => {
    const outcome = await runMaintain(runtime({
      verdict: 'no_issues',
      plan: [],
      notes: [
        'dup_heading / overlong_line / narrow_name: the fixture library is intentionally malformed; nothing to do',
      ],
    }))
    expect(outcome.ok).toBe(true)
    // The completeness gate forces one note per over-signal for no_issues; the
    // renderer used to return "Nothing to do." and drop every one of them.
    expect(outcome.text ?? '').toContain('Nothing to do.')
    expect(outcome.text ?? '').toContain('Notes:')
    expect(outcome.text ?? '').toContain('dup_heading / overlong_line / narrow_name')
  })

  it('V27 M-02: an unreadable tree is NOT reported as an empty, clean library', async () => {
    // `list()` yields entries but every body reads as null (missing SKILL.md, or
    // a directory name the name rule refuses): the tree was never audited, so
    // "nothing to do" would be a false clean bill.
    const outcome = await runMaintain({
      library: {
        async list() { return [{ name: 'ghost-a' }, { name: 'ghost-b' }] },
        async read() { return null },
      },
      subagents: { start: neverStart() },
      parent: maintAgent(),
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('could not read 2 listed skill(s)')
    expect(outcome.error ?? '').toContain('NOT audited')
  })

  it('V27 M-02: a missing skill root is reported as a configuration error, not an empty library', async () => {
    const outcome = await runMaintain({
      library: { async list() { return [] }, async read() { return undefined } },
      subagents: { start: neverStart() },
      parent: maintAgent(),
      rootExists: async () => false,
      skillRoot: '~/my-skills',
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error ?? '').toContain('does not exist')
    expect(outcome.error ?? '').toContain('~/my-skills')
    expect(outcome.error ?? '').toContain('~')
    // The probe answering "it exists" keeps the genuine empty-library path.
    const empty = await runMaintain({
      library: { async list() { return [] }, async read() { return undefined } },
      subagents: { start: neverStart() },
      parent: maintAgent(),
      rootExists: async () => true,
    })
    expect(empty.ok).toBe(true)
    expect(empty.text ?? '').toContain('empty skill library')
  })

  // F-16: the subagent output instruction is the `maintainOutput`
  // PROMPT_BUNDLE entry — no second, undigested prompt text hardcoded in the
  // orchestrator.
  it('F-16: the output instruction rides PROMPT_BUNDLE and closes the prompt verbatim', () => {
    expect(PROMPT_BUNDLE.prompts['maintainOutput']).toBe(MAINTAIN_OUTPUT_INSTRUCTION)
    expect(MAINTAIN_OUTPUT_INSTRUCTION).toContain('JSON 维护计划')
  })

  it('F-16: the spawned prompt ends with the bundle instruction after the facts block', async () => {
    let capturedPrompt: string | undefined
    const runtimeWithCapture: MaintainRuntime = {
      library: fakeLibrary(),
      parent: maintAgent(),
      subagents: {
        async start(_kind: 'spawn', options: SubagentStartRequestLike) {
          capturedPrompt = (options as unknown as { prompt?: Array<{ text: string }> }).prompt?.[0]?.text
          return runStub({ text: 'x', structured: validResult })
        },
      },
    }
    const outcome = await runMaintain(runtimeWithCapture)
    expect(outcome.ok).toBe(true)
    expect(capturedPrompt ?? '').toContain('MECHANICAL_FACTS')
    expect(capturedPrompt?.endsWith(MAINTAIN_OUTPUT_INSTRUCTION)).toBe(true)
  })
})

describe('renderMaintainTemplate', () => {
  it('renders every placeholder and leaves no unresolved signal reference', () => {
    const rendered = renderMaintainTemplate(MAINTAIN_PROMPT, 'dsh-evolution@10', '1', 'sig123')
    expect(rendered).not.toContain('{signal:')
    expect(rendered).not.toContain('{bundle_version}')
    expect(rendered).not.toContain('{signals_version}')
    expect(rendered).not.toContain('{joint_signature}')
    expect(rendered).toContain('sig=sig123')
    for (const id of Object.keys(DRIFT_SIGNAL_NOUNS)) {
      expect(rendered).toContain(DRIFT_SIGNAL_NOUNS[id] ?? id)
    }
  })

  it('keeps signature heads for both sides of the model contract', () => {
    const rendered = renderMaintainTemplate(MAINTAIN_PROMPT, 'dsh-evolution@10', '1', 'sig123')
    expect(rendered).toContain('MAINTAIN_PROMPT v=dsh-evolution@10 sig=sig123')
    expect(rendered).toContain('MECHANICAL_FACTS v=1 sig=sig123')
  })
})
