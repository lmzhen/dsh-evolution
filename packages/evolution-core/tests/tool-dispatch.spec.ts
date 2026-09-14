/**
 * The family's dispatch reader: one signal per platform dispatch, in both
 * runtime modes.
 *
 * The PTC case drives the REAL platform ToolRuntime (\`mode: 'ptc'\`) with a stub
 * CodeRuntime, so the log under test is the platform's own output rather than a
 * transcription. The native case transcribes the agent-loop's two append points
 * (core/agent-loop/src/tool-calls.ts:264 and :282), which is where the native
 * vocabulary is written — the registry itself appends nothing for a
 * model-direct call.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { TOOL_RUNTIME_SCHEDULER, ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import {
  DISPATCH_EVENT_TYPES,
  NATIVE_CALL_EVENT,
  NATIVE_RESULT_EVENT,
  PTC_DISPATCH_EVENT,
  PTC_DISPATCH_START_EVENT,
  ToolDispatchNormalizer,
  ToolDispatchPayloadError,
  assertDispatchPayload,
  collectReadSkillNames,
  countDispatches,
  isSkillReadToolName,
  isSkillToolName,
  readDispatchSignal,
  skillReadNameOf,
} from '../src/tool-dispatch.ts'
import { observeEvent, type TurnSignals } from '../src/signals.ts'

/** A one-line program that reads two skills through the SDK's \`tools\` namespace. */
class ProbeCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'dispatch-spec'
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const namespace = request.bindings.find(entry => entry.global === 'tools')
    if (namespace === undefined) return { logs: [], error: { kind: 'exception', message: 'no tools namespace' } }
    const first = await namespace.functions['skill']!({ name: 'demo-skill' })
    const second = await namespace.functions['skill']!({ name: 'demo-skill' })
    return { value: { first, second }, logs: [] }
  }
}

function skillTool() {
  return defineTool({
    name: 'skill',
    description: 'Load one skill body by name.',
    parameters: { name: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { body: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.body }],
    },
    async execute() { return { body: 'demo skill body' } },
  })
}

type LoggedEvent = { type: string; data?: unknown }

/** Platform logs are branded: the accessor returns \`readonly SessionEvent[]\`. */
const asLog = (events: readonly { type: string; data?: unknown }[]): LoggedEvent[] => events as LoggedEvent[]

/** The platform's own PTC log: real ToolRuntime in \`mode: 'ptc'\`, real bridge. */
async function ptcLog(): Promise<LoggedEvent[]> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ProbeCodeRuntime)
  await ctx.plugin(ToolRuntime, { mode: 'ptc' })
  ctx.tools.register(skillTool())
  const session = ctx.sessions.create(SessionId('spec-ptc'))
  const agent = { id: SessionId('spec-ptc'), session, ctx } as never
  await ctx.tools.execute({
    callId: 'c1', name: 'run_code',
    arguments: { code: 'await tools.skill({name:"demo-skill"})', description: 'read two skills' },
    agent, signal: new AbortController().signal,
  } as never)
  return asLog(session.snapshotEvents())
}

/** The native vocabulary, appended exactly where the agent loop appends it. */
async function nativeLog(rawCallId: string, name: string, args: unknown, isError = false): Promise<LoggedEvent[]> {
  const callId = ToolCallId(rawCallId)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(skillTool())
  const session = ctx.sessions.create(SessionId('spec-native-' + rawCallId))
  const agent = { id: SessionId('spec-native-' + rawCallId), session, ctx } as never
  const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({
    callId, name, arguments: args, agent, signal: new AbortController().signal,
  })
  const exec = (prepared as unknown as { exec: never }).exec
  // The payloads are the agent loop's own shapes, cast once at the append site:
  // the spec deliberately writes them as plain objects.
  const callSeq = session.append(NATIVE_CALL_EVENT, {
    turn: 1, step: 0, callId, name, arguments: JSON.stringify(args),
  }).seq
  const dispatched = await ctx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(exec)
  const result = dispatched.kind === 'post-result'
    ? await ctx.tools[TOOL_RUNTIME_SCHEDULER].finalize(exec, dispatched.result)
    : ctx.tools[TOOL_RUNTIME_SCHEDULER].finish(exec, dispatched.result)
  const typed = result as unknown as { content: object[]; isError: boolean }
  // The block list mirrors the platform's own `createToolResultMessage` output;
  // the spec builds it by hand, so it is cast once at the append site.
  session.append(NATIVE_RESULT_EVENT, {
    turn: 1, step: 0,
    message: {
      role: 'user',
      source: { kind: 'tool', callId },
      content: typed.content.map(block => ({ ...block, type: 'tool-result', toolCallId: callId, isError: isError || typed.isError })),
    },
  } as never, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
  return asLog(session.snapshotEvents())
}

function freshSignal(): TurnSignals {
  return { substantive: false, toolCalls: 0, userChars: 0, assistantChars: 0, memorySignal: false, skillSignal: false }
}

describe('PTC mode (the shipped ptc preset)', () => {
  it('normalizes a run_code skill read: one signal per sub-dispatch, name and outcome attached', async () => {
    const events = await ptcLog()
    // The log really is the PTC vocabulary: a start and a settle per sub-call.
    const types = events.map(event => event.type)
    expect(types.filter(type => type === PTC_DISPATCH_START_EVENT)).toHaveLength(2)
    expect(types.filter(type => type === PTC_DISPATCH_EVENT)).toHaveLength(2)
    expect(types).not.toContain(NATIVE_CALL_EVENT)

    const signals = new ToolDispatchNormalizer().foldAll(events)
    expect(signals).toHaveLength(2)
    expect(signals.map(signal => signal.name)).toEqual(['skill', 'skill'])
    expect(signals.map(signal => signal.kind)).toEqual(['program', 'program'])
    expect(signals.map(signal => signal.ok)).toEqual([true, true])
    expect(signals.map(signal => skillReadNameOf(signal))).toEqual(['demo-skill', 'demo-skill'])
    expect([...collectReadSkillNames(events)]).toEqual(['demo-skill'])
  })

  it('yields the read credit the review gate consumes — the set that used to stay empty', async () => {
    const events = await ptcLog()
    // The review's read-before-write gate consumes exactly this name set
    // ('collectReadSkillNames' in evolution-review/src). Its production wiring is
    // covered end to end in that package's session-accessor-real-session.spec.ts
    // ("v37 P7a"), which asserts the PTC read actually lands the plan op.
    expect([...collectReadSkillNames(events)]).toEqual(['demo-skill'])
  })

  it('counts a failed sub-read as a dispatch but not as a skill read', () => {
    const events: LoggedEvent[] = [
      { type: PTC_DISPATCH_START_EVENT, data: { rootCallId: 'c1', parentCallId: 'c1', subCallId: 'c1:ptc:1', name: 'skill', arguments: { name: 'demo-skill' } } },
      { type: PTC_DISPATCH_EVENT, data: { rootCallId: 'c1', parentCallId: 'c1', subCallId: 'c1:ptc:1', name: 'skill', arguments: { name: 'demo-skill' }, isError: true, content: [] } },
    ]
    const signals = new ToolDispatchNormalizer().foldAll(events)
    expect(signals).toHaveLength(1)
    expect(signals[0]?.ok).toBe(false)
    expect(skillReadNameOf(signals[0]!)).toBeUndefined()
    expect([...collectReadSkillNames(events)]).toEqual([])
  })
})

describe('native mode (the tool/call vocabulary)', () => {
  it('normalizes one staged call: one signal, settled by its tool/result', async () => {
    const events = await nativeLog('n1', 'skill', { name: 'demo-skill' })
    expect(events.map(event => event.type)).toEqual([NATIVE_CALL_EVENT, NATIVE_RESULT_EVENT])
    const signals = new ToolDispatchNormalizer().foldAll(events)
    expect(signals).toHaveLength(1)
    expect(signals[0]?.kind).toBe('native')
    expect(signals[0]?.name).toBe('skill')
    expect(signals[0]?.ok).toBe(true)
    expect([...collectReadSkillNames(events)]).toEqual(['demo-skill'])
  })

  it('reports a failed read through the tool/result error marker, without crashing on legacy shapes', () => {
    const events: LoggedEvent[] = [
      { type: NATIVE_CALL_EVENT, data: { turn: 1, step: 0, callId: 'n2', name: 'skill', arguments: '{"name":"demo-skill"}' } },
      // Legacy/alternative result shapes: the failure rides on the event-level
      // `error` (or a block-level `isError`), and the block may carry no
      // `message.source` at all. Neither may throw in the fold.
      { type: NATIVE_RESULT_EVENT, data: { turn: 1, step: 0, error: { name: 'ToolError', code: 'E_FAIL' } } },
      { type: NATIVE_RESULT_EVENT, data: { turn: 1, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'n2', isError: true }] } } },
    ]
    const signals = new ToolDispatchNormalizer().foldAll(events)
    expect(signals).toHaveLength(1)
    expect(signals[0]?.ok).toBe(false)
    expect([...collectReadSkillNames(events)]).toEqual([])
  })

  it('tolerates a JSON-null arguments payload (F-203) and a non-skill tool', () => {
    const events: LoggedEvent[] = [
      { type: NATIVE_CALL_EVENT, data: { turn: 1, step: 0, callId: 'n3', name: 'skill', arguments: 'null' } },
      { type: NATIVE_CALL_EVENT, data: { turn: 1, step: 0, callId: 'n4', name: 'read_file', arguments: '{"path":"x"}' } },
    ]
    expect(new ToolDispatchNormalizer().foldAll(events).map(signal => skillReadNameOf(signal))).toEqual([undefined, undefined])
    expect([...collectReadSkillNames(events)]).toEqual([])
    expect(isSkillReadToolName('read_file')).toBe(false)
    expect(isSkillToolName('skill_manage')).toBe(true)
  })
})

describe('the one-dispatch invariant', () => {
  it('a PTC start/settle pair counts once, and a duplicated event never counts twice', async () => {
    const events = await ptcLog()
    const realCount = countDispatches(events)
    expect(realCount).toBe(2)
    // The platform may re-deliver the same lifecycle event (replay, or a future
    // build that logs both vocabularies): the identity is the subCallId, so the
    // count is still two, not four.
    const replayed = [...events, ...events]
    expect(countDispatches(replayed)).toBe(2)
    // A pair with the same subCallId twice inside one log is still one dispatch.
    const start = events[0]!
    expect(countDispatches([start, start])).toBe(1)
    // The second event of an emitted dispatch is never an emission again.
    const normalizer = new ToolDispatchNormalizer()
    const emissions = events.map(event => normalizer.advance(event)).filter(signal => signal !== null)
    expect(emissions).toHaveLength(2)
  })

  it('a start and a settle for the same identity yield one signal, settled in place', () => {
    const events: LoggedEvent[] = [
      { type: PTC_DISPATCH_START_EVENT, data: { rootCallId: 'r1', parentCallId: 'r1', subCallId: 'r1:ptc:1', name: 'skill', arguments: { name: 'demo-skill' } } },
      { type: PTC_DISPATCH_EVENT, data: { rootCallId: 'r1', parentCallId: 'r1', subCallId: 'r1:ptc:1', name: 'skill', arguments: { name: 'demo-skill' }, isError: false, content: [] } },
    ]
    const normalizer = new ToolDispatchNormalizer()
    const first = normalizer.advance(events[0]!)
    expect(first).not.toBeNull()
    expect(first?.ok).toBeUndefined()
    expect(normalizer.advance(events[1]!)).toBeNull()
    // The caller holds the SAME object; the settle folded into it.
    expect(first?.ok).toBe(true)
    expect(normalizer.signals).toHaveLength(1)
  })

  it('a native call and its result are one dispatch; a result alone is none', () => {
    const call: LoggedEvent = { type: NATIVE_CALL_EVENT, data: { turn: 1, step: 0, callId: 'n5', name: 'skill', arguments: '{"name":"demo-skill"}' } }
    const result: LoggedEvent = { type: NATIVE_RESULT_EVENT, data: { turn: 1, step: 0, message: { source: { callId: 'n5' }, content: [] } } }
    expect(countDispatches([call, result])).toBe(1)
    // A result never MINTS a dispatch: it is the second half of one. Neither
    // result shape may crash the fold or add a call of its own, whether it
    // names its call in the message or on a result block.
    expect(countDispatches([result])).toBe(0)
    expect(countDispatches([{ type: NATIVE_RESULT_EVENT, data: { turn: 1, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'n5' }] } } }])).toBe(0)
    expect(readDispatchSignal(result)).toBeNull()
  })
})

describe('the family signal fold (review cadence)', () => {
  it('advances toolCalls once per sub-dispatch and raises the skill signal in PTC mode', async () => {
    const events = await ptcLog()
    const signal = freshSignal()
    for (const event of events) observeEvent(signal, event as never)
    // Two sub-dispatches, both `program` kind: neither is a model-facing call,
    // so the cadence counter does not move — and the skill signal, which used
    // to stay false for every PTC session, is raised.
    expect(signal.toolCalls).toBe(0)
    expect(signal.skillSignal).toBe(true)
  })

  it('counts the native call once, and never twice for the call/result pair', async () => {
    const events = await nativeLog('n6', 'skill', { name: 'demo-skill' })
    const signal = freshSignal()
    for (const event of events) observeEvent(signal, event as never)
    expect(signal.toolCalls).toBe(1)
    expect(signal.skillSignal).toBe(true)
  })

  it('keeps a direct call counted when a program sub-dispatch follows it', () => {
    const events: LoggedEvent[] = [
      { type: NATIVE_CALL_EVENT, data: { turn: 1, step: 0, callId: 'd1', name: 'skill', arguments: '{"name":"demo-skill"}' } },
      { type: PTC_DISPATCH_START_EVENT, data: { rootCallId: 'c9', parentCallId: 'c9', subCallId: 'c9:ptc:1', name: 'skill', arguments: { name: 'demo-skill' } } },
      { type: PTC_DISPATCH_EVENT, data: { rootCallId: 'c9', parentCallId: 'c9', subCallId: 'c9:ptc:1', name: 'skill', arguments: { name: 'demo-skill' }, isError: false, content: [] } },
    ]
    const signal = freshSignal()
    for (const event of events) observeEvent(signal, event as never)
    expect(signal.toolCalls).toBe(1)
    expect(signal.skillSignal).toBe(true)
  })
})

describe('refusal instead of silent downgrade', () => {
  it('rejects a dispatch payload that violates the platform declaration', () => {
    // `assertDispatchPayload` returns void, so each refusal is its own statement.
    const refusals: Array<[LoggedEvent, RegExp | typeof ToolDispatchPayloadError]> = [
      [{ type: NATIVE_CALL_EVENT, data: { turn: 1, step: 0, callId: 'x' } }, ToolDispatchPayloadError],
      [{ type: PTC_DISPATCH_START_EVENT, data: { name: 'skill' } }, /subCallId/],
      [{ type: PTC_DISPATCH_EVENT, data: { subCallId: 's', name: 'skill' } }, /isError/],
      [{ type: 'turn/end', data: {} }, /is not a platform dispatch event/],
    ]
    for (const [event, expected] of refusals) {
      expect(() => { assertDispatchPayload(event) }).toThrow(expected)
    }
    assertDispatchPayload({ type: NATIVE_CALL_EVENT, data: { turn: 1, step: 0, callId: 'x', name: 'skill', arguments: '{}' } })
  })

  it('never throws out of the fold for a malformed or hostile log', () => {
    const namelessFrame: LoggedEvent = { type: NATIVE_CALL_EVENT, data: { turn: 1, step: 0 } }
    const hostile: LoggedEvent[] = [
      // Three id-less call frames + one event from a retired vocabulary. An
      // id-less REAL log only exists for a replayed pre-upgrade frame or an
      // external emitter, and the platform's writer always supplies the id.
      { type: NATIVE_CALL_EVENT, data: null },
      { type: NATIVE_CALL_EVENT },
      { type: PTC_DISPATCH_EVENT, data: { name: 42 } },
      { type: 'tool/code-dispatch', data: { callId: 'legacy' } },
    ]
    // The fold reads persisted logs, so it answers \`null\` (or a name-less
    // dispatch) instead of throwing: a corrupt log must not take the
    // conversation's review pipeline down.
    expect(() => new ToolDispatchNormalizer().foldAll(hostile)).not.toThrow()
    expect(countDispatches(hostile)).toBe(3)
    expect(new ToolDispatchNormalizer().foldAll(hostile).map(signal => signal.name)).toEqual(['malformed', 'malformed', 'malformed'])
    // The id-less identity is the payload, so the SAME broken frame delivered
    // twice is still one dispatch — the dedup rule has no exception.
    expect(countDispatches([namelessFrame, namelessFrame])).toBe(1)
    // A retired vocabulary is not a dispatch at all.
    expect(countDispatches([{ type: 'tool/code-dispatch', data: { callId: 'legacy' } }])).toBe(0)
  })

  it('exposes the dispatch vocabulary as the module\'s own constants', () => {
    expect([...DISPATCH_EVENT_TYPES]).toEqual([NATIVE_CALL_EVENT, NATIVE_RESULT_EVENT, PTC_DISPATCH_START_EVENT, PTC_DISPATCH_EVENT])
  })
})

describe('arch guard N11: one reader for the dispatch vocabulary', () => {
  // The same pattern verify-arch-guards.mjs applies per file over
  // comment-stripped, string-preserving source. Keeping it here means a
  // consumer that starts matching an event type is caught by the package suite
  // as well as by the tree-wide gate.
  const QUOTED_DISPATCH_TYPE_RE = /['"`](tool\/(?:call|result|ptc-dispatch-start|ptc-dispatch))['"`]/
  const CORE_DISPATCH_CONSTANT_RE = new RegExp('\\b(?:PTC_DISPATCH_START_EVENT|PTC_DISPATCH_EVENT' + '|NATIVE_CALL_EVENT|NATIVE_RESULT_EVENT|DISPATCH_EVENT_TYPES)\\b')
  const matchesDispatchVocabulary = (source: string): boolean =>
    QUOTED_DISPATCH_TYPE_RE.test(source) || CORE_DISPATCH_CONSTANT_RE.test(source)
  const NEW_DRIFT = [
    "if (event.type === 'tool/ptc-dispatch') return",
    "if (event.type !== 'tool/call') return",
    'const seen = events.filter(event => event.type === "tool/result")',
    'const isSettle = type => type === PTC_DISPATCH_EVENT',
    'const SET: readonly string[] = [...NATIVE_CALL_EVENT, NATIVE_RESULT_EVENT]',
  ]
  it('rejects every way a second matcher could reintroduce the modality blindness', () => {
    for (const sample of NEW_DRIFT) expect(matchesDispatchVocabulary(sample), sample).toBe(true)
  })

  it('accepts prose, and accepts the normalizer\'s own field comparison', () => {
    const benign = [
      '// a PTC session logs tool/ptc-dispatch instead of tool/call',
      '/** The tool-result payload of a native call. */',
      "const label = 'dispatch ledger'",
      "if (dispatch.kind === 'program') return",
    ]
    for (const sample of benign) expect(matchesDispatchVocabulary(sample), sample).toBe(false)
  })
})

describe('modality parity: the same work reads the same in both runtime modes', () => {
  /**
   * The acceptance the C-axis owes (v41 §C): ONE script scenario, driven twice —
   * two model-direct reads (native) versus one program that reads the same two
   * skills (PTC). Everything a family CONSUMER may look at has to agree: the
   * read-name set the review gate credits, the number of dispatches the work
   * produced, and the review skill signal. A consumer that reintroduces a
   * per-modality branch fails here before it can go blind in the field (the v37
   * P7a incident: PTC sessions credited zero reads while the code looked right).
   *
   * The two native calls are folded from two single-call logs concatenated: the
   * fold is a pure function of the event list (dedup is per call id), and the
   * helper drives the real staged scheduler for each call.
   */
  it('two direct reads and one program doing two reads agree on names, count and signal', async () => {
    const native: LoggedEvent[] = [
      ...(await nativeLog('parity-n1', 'skill', { name: 'demo-skill' })),
      ...(await nativeLog('parity-n2', 'skill', { name: 'demo-skill' })),
    ]
    const ptc = await ptcLog()
    // The route is the ONLY permitted difference: who delivered the call.
    expect(native.map(event => event.type)).toEqual([NATIVE_CALL_EVENT, NATIVE_RESULT_EVENT, NATIVE_CALL_EVENT, NATIVE_RESULT_EVENT])
    expect(ptc.map(event => event.type)).not.toContain(NATIVE_CALL_EVENT)

    // Modality-blind facts, asserted as equalities between the two logs.
    expect([...collectReadSkillNames(native)]).toEqual([...collectReadSkillNames(ptc)])
    expect([...collectReadSkillNames(native)]).toEqual(['demo-skill'])
    expect(countDispatches(native)).toBe(countDispatches(ptc))
    for (const log of [native, ptc]) {
      const signal = freshSignal()
      for (const event of log) observeEvent(signal, event as never)
      expect(signal.skillSignal, JSON.stringify(log.map(event => event.type))).toBe(true)
    }
    // The model-facing counter is NOT part of the parity claim: it counts the
    // calls the MODEL made, so the sub-dispatches of a program are excluded by
    // design (the one registered branch, arch guard N17).
    const nativeSignal = freshSignal()
    for (const event of native) observeEvent(nativeSignal, event as never)
    expect(nativeSignal.toolCalls).toBe(2)
  })
})


