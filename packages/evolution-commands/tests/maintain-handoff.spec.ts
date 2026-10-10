/**
 * G2 (0.20.0) command-face fixtures: `maintain handoff`, id-less `report`/`cancel`,
 * the three empty states, and the opt-in automatic handoff. Every case runs under
 * `tempHome`, so the real evolution home is never touched.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import * as Commands from '../src/index.ts'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../test-support/temp-home.ts'
import { captureCommands } from '../../test-support/commands-stub.ts'

type Result = { kind: 'success' | 'error'; text: string }
type Handler = { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<Result> }

type Receiver = { agent: Record<string, unknown>; calls: string[]; sent: () => string }

/**
 * A fake session receiver. `followup`/`inject` are PROTOTYPE methods that write through
 * `this`, so a detached call throws — that is the 0.3.73 shape the N13b rule exists for.
 * @param mode - which primitive the host exposes.
 * @returns the agent plus what it received.
 */
function receiver(mode: 'followup' | 'inject' | 'proto' | 'none'): Receiver {
  const calls: string[] = []
  const proto = {
    followup(this: Record<string, unknown>, message: unknown) {
      this['sent'] = message
      calls.push('followup')
    },
    inject(this: Record<string, unknown>, message: unknown) {
      this['sent'] = message
      calls.push('inject')
    },
  }
  const agent: Record<string, unknown> = mode === 'proto' ? Object.create(proto) : {}
  if (mode === 'followup') agent['followup'] = proto.followup
  if (mode === 'inject') agent['inject'] = proto.inject
  const sent = (): string => {
    const message = agent['sent'] as { content?: Array<{ text?: string }> } | undefined
    return message?.content?.[0]?.text ?? ''
  }
  return { agent, calls, sent }
}

/** The demo-skill this bed scans. It is a REAL multi-line body: the earlier form joined everything
 * with a literal `\\n`, so it was one 2.5 kchar line and the signals the structured plan names were
 * never the ones this file produces (review P2-10). The plan below stays hand-written fixture data —
 * the validator accepts any known signal id — so this body only has to be a valid skill on disk. */
const SKILL_BODY = ['---', 'name: demo-skill', 'description: Demo skill.', '---', '', '# x', '', '## A', '', '## A', '', 'y'.repeat(2_500), ''].join('\n')

/** A structured plan the validator accepts in this bed (copy of the report fixture). */
const STRUCTURED_PLAN = {
  verdict: 'issues',
  plan: [{
    kind: 'skill-level',
    names: ['demo-skill'],
    rule: 'B3',
    evidence: [
      { signal: 'dup_heading', value: 'A(2)' },
      { signal: 'overlong_line', value: '7:2500' },
      { signal: 'narrow_name', value: 'session-verb' },
    ],
    finding: 'Duplicate heading.',
    recommendation: 'patch: remove the duplicate heading',
    semantic_reasoning: 'duplicate heading shape',
    impact: 'better',
    impact_reason: 'remove duplicate',
    reversibility: 'patch',
    undo_path: 'backup restore',
    confidence: 0.8,
    needs_human: true,
    is_override: false,
  }],
  notes: ['a plain note'],
}

async function mount(options: { handoff?: boolean } = {}) {
  const dir = await tempHome('evo-g2-handoff-')
  const root = join(dir, 'skills')
  const skillDir = join(root, 'demo-skill')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), SKILL_BODY, 'utf8')
  const ctx = new Context()
  let handler: Handler | undefined
  ctx.provide('commands', captureCommands((definition) => { handler = definition as Handler }))
  ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
  let releaseOutcome: (() => void) | undefined
  ctx.provide('subagents', {
    async start() {
      return { result: new Promise((resolve) => { releaseOutcome = () => { resolve({ text: 'x', structured: STRUCTURED_PLAN }) } }) }
    },
  })
  await ctx.plugin(Commands, { root, maintainCooldownMs: 0, ...(options.handoff === true ? { maintainHandoffOnSettle: true } : {}) })
  return {
    dir,
    handler: handler as Handler,
    releaseReady: () => releaseOutcome !== undefined,
    release: () => releaseOutcome?.(),
  }
}

async function waitSettled(handler: Handler, id: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const status = await handler.handler({ rawInput: 'maintain status ' + id })
    if (!/\srunning\s/.test(status.text)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('maintenance run never settled')
}

describe('G2 (0.20.0) maintain handoff and id-less subcommands', () => {
  it('names the three empty states instead of one blurry answer', async () => {
    const bed = await mount()
    for (const line of ['maintain report', 'maintain cancel', 'maintain handoff']) {
      const answer = await bed.handler.handler({ rawInput: line, agent: receiver('followup').agent })
      expect(answer.kind, line).toBe('error')
      expect(answer.text, line).toContain('No maintenance run recorded in this home yet')
      expect(answer.text, line).not.toContain('No run  in this home')
    }
    const bad = await bed.handler.handler({ rawInput: 'maintain report nope' })
    expect(bad.text).toContain('No run nope in this home')
    await mkdir(join(bed.dir, 'evolution'), { recursive: true })
    await writeFile(join(bed.dir, 'evolution', 'runs.json'), 'not an index', 'utf8')
    const unreadable = await bed.handler.handler({ rawInput: 'maintain report' })
    expect(unreadable.kind).toBe('error')
    expect(unreadable.text).toContain('is not readable')
    expect(unreadable.text).toContain('NOT')
  })

  it('answers sentence F for the id-less forms when a stale in-memory view meets an unreadable index (review P1-1)', async () => {
    const bed = await mount()
    const home = join(bed.dir, 'evolution')
    await mkdir(home, { recursive: true })
    // Deterministic on purpose: a settled row the process learns about FIRST (no scan, no timer),
    // so its in-memory view is non-empty when the home's index goes bad.
    await writeFile(join(home, 'runs.json'), JSON.stringify({
      schemaVersion: 1,
      runs: [{
        id: 'stale-1', kind: 'maintain', state: 'succeeded', startedAt: 1, endedAt: 2,
        resultRef: join(home, 'reports', 'maintain-stale-1.json'),
      }],
    }), 'utf8')
    const listed = await bed.handler.handler({ rawInput: 'maintain status' })
    expect(listed.kind).toBe('success')
    expect(listed.text).toContain('stale-1')
    // …and THEN the index becomes unreadable. Every id-less form must say so instead of answering
    // from the stale view (the posture `maintain status` already takes for its list branch).
    const corrupt = (): Promise<void> => writeFile(join(home, 'runs.json'), 'not an index', 'utf8')
    await corrupt()
    const report = await bed.handler.handler({ rawInput: 'maintain report' })
    expect(report.kind).toBe('error')
    expect(report.text).toContain('is not readable')
    expect(report.text).not.toContain('has NO result')
    await corrupt()
    const handoff = receiver('followup')
    const refused = await bed.handler.handler({ rawInput: 'maintain handoff', agent: handoff.agent })
    expect(refused.kind).toBe('error')
    expect(refused.text).toContain('is not readable')
    expect(handoff.calls).toEqual([])
    await corrupt()
    const cancel = await bed.handler.handler({ rawInput: 'maintain cancel' })
    expect(cancel.kind).toBe('error')
    expect(cancel.text).toContain('is not readable')
    // An explicit id still answers from this process's own history (no report file => "no result",
    // NOT the index sentence), while an unknown id says the unreadable index proves nothing.
    const known = await bed.handler.handler({ rawInput: 'maintain report stale-1' })
    expect(known.kind).toBe('error')
    expect(known.text).toContain('has NO result')
    await corrupt()
    const unknown = await bed.handler.handler({ rawInput: 'maintain report nope' })
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('NOT proof the run never happened')
  })


  it('hands a settled report over as a pointer plus protocol, and refuses while running', async () => {
    const bed = await mount()
    const auto = receiver('followup')
    const started = await bed.handler.handler({ rawInput: 'maintain', agent: auto.agent })
    const id = /Maintenance run (\S+) started/.exec(started.text)?.[1] as string
    expect(id).toBeTruthy()
    const early = receiver('followup')
    const running = await bed.handler.handler({ rawInput: 'maintain handoff', agent: early.agent })
    expect(running.kind).toBe('error')
    expect(running.text).toContain('is still running')
    expect(early.calls).toEqual([])
    for (let attempt = 0; attempt < 500 && !bed.releaseReady(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
    bed.release()
    await waitSettled(bed.handler, id)
    expect(auto.calls, 'the switch is OFF by default: settling injects nothing').toEqual([])
    const asked = receiver('followup')
    const handed = await bed.handler.handler({ rawInput: 'maintain handoff', agent: asked.agent })
    expect(handed.kind).toBe('success')
    expect(handed.text).toContain('Handed run ' + id + ' to the model')
    expect(asked.calls).toEqual(['followup'])
    const pointer = asked.sent()
    expect(pointer).toContain('[evolution maintain]')
    expect(pointer).toContain('maintain-' + id + '.md')
    expect(pointer).toContain('REPORT-ONLY')
    expect(pointer).toContain('skill_manage')
    // G1's ledger supplies the confirmation count; without it (its revert drill) the clause
    // is OMITTED rather than guessed — the pointer still carries the run, verdict and path.
    expect(pointer).toContain('verdict=issues')
    expect(pointer).toContain('1 recommendations')
    if (pointer.includes('of them need your user')) expect(pointer).toMatch(/1 of them need your user/)
    const report = await bed.handler.handler({ rawInput: 'maintain report' })
    expect(report.kind).toBe('success')
    expect(report.text).toContain('verdict=issues')
    const cancel = await bed.handler.handler({ rawInput: 'maintain cancel' })
    expect(cancel.kind).toBe('error')
    expect(cancel.text).toContain('nothing to cancel')
    const queued = receiver('inject')
    const viaInject = await bed.handler.handler({ rawInput: 'maintain handoff', agent: queued.agent })
    expect(viaInject.text).toContain('queued')
    expect(queued.calls).toEqual(['inject'])
    const none = await bed.handler.handler({ rawInput: 'maintain handoff', agent: {} })
    expect(none.kind).toBe('error')
    expect(none.text).toContain('E-305')
    const proto = receiver('proto')
    const onReceiver = await bed.handler.handler({ rawInput: 'maintain handoff', agent: proto.agent })
    expect(onReceiver.kind).toBe('success')
    expect(proto.calls, 'the primitive is called ON the receiver (N13b)').toEqual(['followup'])
  })

  it('hands the report over automatically only when the switch is on', async () => {
    const bed = await mount({ handoff: true })
    const auto = receiver('followup')
    const started = await bed.handler.handler({ rawInput: 'maintain', agent: auto.agent })
    expect(started.kind).toBe('success')
    // The scan settles only when the stub's outcome is released; the handoff rides on that settle.
    for (let attempt = 0; attempt < 500 && !bed.releaseReady(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
    bed.release()
    for (let attempt = 0; attempt < 500 && auto.calls.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(auto.calls).toEqual(['followup'])
    expect(auto.sent()).toContain('REPORT-ONLY')
  })
}, 20_000) // every cell here polls a stub on a 10 ms tick; the 5 s default is a load flake waiting to happen.
