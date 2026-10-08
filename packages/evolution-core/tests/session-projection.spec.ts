/**
 * The family's session projection units (G4).
 *
 * 0.2.x deprecates the synchronous session-log reads; each unit here must answer EXACTLY what the
 * pure log reader it replaces answers for the same log — that equivalence is the whole point of
 * the migration, so these cases fold one real Session through both paths and compare every
 * question the consumers ask.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { evidenceKindIndex } from '../src/evidence.ts'
import { collectReadSkillNames } from '../src/tool-dispatch.ts'
import { foldTurnEvents } from '../src/signals.ts'
import { installEvolutionProjections, sessionEvidenceIndex, sessionLastEventTime, sessionReadNames, sessionTurnSignals } from '../src/session-projection.ts'

/** A context with the store and the projection registry the family's units register into. */
async function mounted(): Promise<{ ctx: Context; session: ReturnType<Context['sessions']['create']> }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  // The units install on the first READ of a foldable session (the readers own registration),
  // so the helper installs nothing itself.
  const session = ctx.sessions.create(SessionId('projection-spec'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'I prefer concise answers and want you to remember that preference.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { ctx, session }
}

describe('evolution session projections (G4)', () => {
  it('classifies evidence exactly like the pure whole-log reader', async () => {
    const { ctx, session } = await mounted()
    // The reference reader is the deprecated one on purpose: it is the behavior being preserved.
    const pure = evidenceKindIndex(session.snapshotEvents())
    const projected = sessionEvidenceIndex(ctx, session)
    expect(pure).toBeDefined()
    expect(projected).toBeDefined()
    // Every seq the dense set answers for, plus one past the log end and one negative.
    for (let seq = -1; seq <= session.seq + 1; seq += 1) {
      expect(projected?.has(seq), 'seq ' + String(seq)).toBe(pure?.has(seq))
    }
  })

  it('answers the newest event time like the log tail does', async () => {
    const { ctx, session } = await mounted()
    const events = session.snapshotEvents()
    expect(sessionLastEventTime(ctx, session)).toBe(events[events.length - 1]?.time)
  })

  it('reports cannot-classify on a host with no projection registry, and on a structural view', async () => {
    // The registry is part of the platform's base bundle; a composition without it has no
    // projection state to read, and neither has a session-shaped stub the registry cannot fold.
    const bare = new Context()
    await bare.plugin(SessionStore)
    const plain = bare.sessions.create(SessionId('projection-noreg'))
    plain.append('turn/start', { turn: 1 })
    expect(sessionEvidenceIndex(bare, plain)).toBeUndefined()
    expect(sessionLastEventTime(bare, plain)).toBeUndefined()
    const { ctx, session } = await mounted()
    const stub = { id: session.id, snapshotEvents: () => session.snapshotEvents() } as unknown as typeof session
    expect(sessionEvidenceIndex(ctx, stub)).toBeUndefined()
    expect(sessionLastEventTime(ctx, stub)).toBeUndefined()
  })

  it('renders a log with no sequenced frame as cannot-classify, not as an empty index', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    installEvolutionProjections(ctx)
    const session = ctx.sessions.create(SessionId('projection-empty'))
    // The pure reader's three-state answer: an empty LOG is "cannot classify", while a log whose
    // frames are all boundaries is the EMPTY set (a different fact).
    expect(evidenceKindIndex(session.snapshotEvents())).toBeUndefined()
    expect(sessionEvidenceIndex(ctx, session)).toBeUndefined()
    session.append('turn/start', { turn: 1 })
    expect(evidenceKindIndex(session.snapshotEvents())).toEqual(new Set())
    expect(sessionEvidenceIndex(ctx, session)?.has(0)).toBe(false)
  })

  it('answers read names exactly like the whole-log dispatch fold, failed reads excluded', async () => {
    const { ctx, session } = await mounted()
    const read = ToolCallId('c-read')
    session.append('tool/call', { turn: 1, step: 1, callId: read, name: 'skill', arguments: JSON.stringify({ name: 'demo-read' }) })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId: read, content: [{ type: 'text', text: 'skill loaded' }], isError: false }),
    }, { surfaceOp: 'append' })
    // v32 REV-06(a): a FAILED read never counts, so the settle must be able to revoke it.
    const doomed = ToolCallId('c-doomed')
    session.append('tool/call', { turn: 1, step: 2, callId: doomed, name: 'skill', arguments: JSON.stringify({ name: 'demo-doomed' }) })
    // The failure rides the payload the way the platform records it (`readDispatchRecord`:
    // payload-level `error`, a result block's `isError`, or the payload's own `isError`).
    session.append('tool/result', {
      turn: 1, step: 2,
      error: { name: 'ToolError', code: 'failed' },
      message: createToolResultMessage({ callId: doomed, content: [{ type: 'text', text: 'read failed' }], isError: true }),
    }, { surfaceOp: 'append' })
    // The reference reader is the deprecated whole-log fold on purpose: it is the behavior kept.
    const pure = collectReadSkillNames(session.snapshotEvents())
    const projected = sessionReadNames(ctx, session)
    expect(pure).toEqual(new Set(['demo-read']))
    expect(projected).toBeDefined()
    expect([...(projected ?? [])].sort()).toEqual([...pure].sort())
  })

  it('answers the open turn window like the whole-log window fold', async () => {
    const { ctx, session } = await mounted()
    const read = ToolCallId('c-window')
    session.append('tool/call', { turn: 1, step: 1, callId: read, name: 'skill', arguments: JSON.stringify({ name: 'demo-window' }) })
    // A PTC sub-dispatch pair counts once (the start/settle pairing the vocabulary owns).
    // PTC sub-dispatches identify by `subCallId` under a program root (the platform's own payload).
    const sub = ToolCallId('sub-1')
    session.append('tool/ptc-dispatch-start', {
      subCallId: sub, rootCallId: read, parentCallId: read, name: 'skill', arguments: { name: 'demo-ptc' },
    })
    session.append('tool/ptc-dispatch', {
      subCallId: sub, rootCallId: read, parentCallId: read, name: 'skill', arguments: { name: 'demo-ptc' }, content: [], isError: false,
    })
    const pure = foldTurnEvents(session.snapshotEvents(), 0)
    const projected = sessionTurnSignals(ctx, session)
    expect(projected).toEqual(pure)
  })
})
