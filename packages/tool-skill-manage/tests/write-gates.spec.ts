/**
 * The write-admission sequence (design dsh-evolution-write-gate-design.md §3/§4.2).
 *
 * Each case is the deliberate violation its gate exists for, plus the control that proves the
 * refusal came from the gate and not from a dead harness.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'
import * as ToolSkillManage from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tempHome } from '../../test-support/temp-home.ts'

/** A session stub: the exec path reads the id, the origin header and the event log. */
function sessionOf(origin: string | undefined, events: readonly unknown[] = []) {
  return { id: `gate-${Math.random()}`, header: { origin }, snapshotEvents: () => events }
}

/**
 * The frames the platform logs for one `skill` read: the call, then its result. A failed read
 * marks the result payload — the shape `foldToolDispatches` folds to `ok: false`.
 */
function readFrames(name: string, failed = false): readonly unknown[] {
  const callId = `read-${name}`
  return [
    { type: 'tool/call', data: { callId, name: 'skill', arguments: JSON.stringify({ name }) } },
    { type: 'tool/result', data: { isError: failed, message: { source: { callId }, content: [] } } },
  ]
}

function skillBody(name: string, body = 'Body.'): string {
  return `---\nname: ${name}\ndescription: write gate fixture\n---\n${body}\n`
}

function skillPath(root: string, name: string): string {
  return join(root, 'skills', name, 'SKILL.md')
}

async function setup(): Promise<{ ctx: Context; root: string }> {
  const root = await tempHome('dsh-write-gates-')
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(SkillUsageRegistry, { root })
  await ctx.plugin(ToolSkillManage)
  return { ctx, root }
}

function callTool(ctx: Context, args: Record<string, unknown>, session: unknown) {
  return ctx.tools.execute({
    callId: ToolCallId(`wg-${Math.random()}`),
    name: 'skill_manage',
    arguments: args,
    agent: { session } as unknown as Agent,
    signal: new AbortController().signal,
  })
}

interface ToolValue {
  ok?: boolean
  message?: string
  pending_id?: string
}

/** The structured result the tool renders, as the tests read it. */
function valueOf(result: { value?: unknown }): ToolValue {
  return result.value as ToolValue
}

/** Stage the target skill through the FOREGROUND path (exempt from read-before-write). */
async function createTarget(ctx: Context, name: string): Promise<void> {
  const created = await callTool(ctx, { action: 'create', name, content: skillBody(name) }, sessionOf(undefined))
  expect(valueOf(created).ok, valueOf(created).message).toBe(true)
}

describe('write gates: read-before-write (E-318)', () => {
  it('refuses a non-foreground write to a skill this session never read', async () => {
    const { ctx, root } = await setup()
    await createTarget(ctx, 'gate-unread')
    const refused = await callTool(
      ctx,
      { action: 'patch', name: 'gate-unread', old_string: 'Body.', new_string: 'Rewritten.' },
      sessionOf('subagent'),
    )
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('E-318')
    expect(valueOf(refused).message).toContain('"gate-unread"')
    expect(await readFile(skillPath(root, 'gate-unread'), 'utf8')).toContain('Body.')
  })

  it('accepts the same write once the session read the skill, and writes it', async () => {
    const { ctx, root } = await setup()
    await createTarget(ctx, 'gate-read')
    const accepted = await callTool(
      ctx,
      { action: 'patch', name: 'gate-read', old_string: 'Body.', new_string: 'Rewritten.' },
      sessionOf('subagent', readFrames('gate-read')),
    )
    expect(valueOf(accepted).ok, valueOf(accepted).message).toBe(true)
    expect(await readFile(skillPath(root, 'gate-read'), 'utf8')).toContain('Rewritten.')
  })

  it('does not count a read that failed (v32 REV-06(a))', async () => {
    const { ctx } = await setup()
    await createTarget(ctx, 'gate-failed-read')
    const refused = await callTool(
      ctx,
      { action: 'patch', name: 'gate-failed-read', old_string: 'Body.', new_string: 'Rewritten.' },
      sessionOf('subagent', readFrames('gate-failed-read', true)),
    )
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('E-318')
  })

  it('exempts the foreground operator session', async () => {
    const { ctx, root } = await setup()
    await createTarget(ctx, 'gate-foreground')
    const accepted = await callTool(
      ctx,
      { action: 'patch', name: 'gate-foreground', old_string: 'Body.', new_string: 'Operator edit.' },
      sessionOf(undefined),
    )
    expect(valueOf(accepted).ok, valueOf(accepted).message).toBe(true)
    expect(await readFile(skillPath(root, 'gate-foreground'), 'utf8')).toContain('Operator edit.')
  })

  it('proceeds with ONE warning when the session log is not readable', async () => {
    const { ctx } = await setup()
    await createTarget(ctx, 'gate-nolog')
    const warns: string[] = []
    // Capture the warning instead of printing it: the assertion needs the text, and the family's
    // usual "then forward to the original" form needs a bound receiver this ctx does not expose.
    ctx.logger.warn = ((message: string) => { warns.push(message) }) as typeof ctx.logger.warn
    // A session object without the events accessor: the check cannot run for this call.
    const bare = { id: 'gate-bare', header: { origin: 'subagent' } }
    const first = await callTool(ctx, { action: 'patch', name: 'gate-nolog', old_string: 'Body.', new_string: 'One.' }, bare)
    const second = await callTool(ctx, { action: 'patch', name: 'gate-nolog', old_string: 'One.', new_string: 'Two.' }, bare)
    expect(valueOf(first).ok, valueOf(first).message).toBe(true)
    expect(valueOf(second).ok, valueOf(second).message).toBe(true)
    expect(warns.filter(message => message.includes('read-before-write'))).toHaveLength(1)
  })

  it('keeps pure refusals ahead of the read gate: a malformed call reports its missing argument', async () => {
    const { ctx } = await setup()
    await createTarget(ctx, 'gate-order')
    const refused = await callTool(ctx, { action: 'patch', name: 'gate-order', old_string: 'Body.' }, sessionOf('subagent'))
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('skill_manage patch requires new_string')
    expect(valueOf(refused).message).not.toContain('E-318')
  })
})

describe('write gates: admission runs before the approval seam', () => {
  /** The approval-enabled harness: a state stub records what would have been staged. */
  async function setupStaged(): Promise<{
    ctx: Context
    root: string
    pending: unknown[]
    requests: () => number
  }> {
    const { ctx, root } = await setup()
    const pending: unknown[] = []
    ctx.provide('evolutionState', {
      listPending: async () => pending,
      savePending: async (record: unknown) => { pending.push(record) },
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })
    // stageForeground: false so the fixture skill is written by its FOREGROUND create instead of
    // being staged; the subagent write under test still reaches the seam (its approval origin is
    // background_review) if the admission gates let it through.
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: false })
    let count = 0
    const box = ctx.evolutionApproval as unknown as Record<string, unknown>
    const realRequest = (box.request as (this: unknown, input: unknown) => Promise<unknown>).bind(ctx.evolutionApproval)
    box.request = async (input: unknown) => { count += 1; return realRequest(input) }
    return { ctx, root, pending, requests: () => count }
  }

  it('refuses an unread write before staging it, so no operator attention is spent', async () => {
    const { ctx, pending, requests } = await setupStaged()
    await createTarget(ctx, 'gate-staged')
    const baseline = requests()
    const refused = await callTool(
      ctx,
      { action: 'patch', name: 'gate-staged', old_string: 'Body.', new_string: 'Rewritten.' },
      sessionOf('subagent'),
    )
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('E-318')
    expect(valueOf(refused).pending_id).toBeUndefined()
    expect(requests()).toBe(baseline)
    expect(pending).toHaveLength(0)
  })

  it('refuses a protected write at admission instead of staging it', async () => {
    const { ctx, root, pending, requests } = await setupStaged()
    await createTarget(ctx, 'gate-protected')
    ctx.provide('evolutionPolicy', { get: () => ({ protectedSkillNames: ['gate-protected'] }) })
    const baseline = requests()
    const refused = await callTool(
      ctx,
      { action: 'patch', name: 'gate-protected', old_string: 'Body.', new_string: 'Rewritten.' },
      sessionOf('subagent', readFrames('gate-protected')),
    )
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('protected by the current policy')
    expect(requests()).toBe(baseline)
    expect(pending).toHaveLength(0)
    expect(await readFile(skillPath(root, 'gate-protected'), 'utf8')).toContain('Body.')
  })
})

describe('write gates: the execution point still refuses a stored plan', () => {
  it('re-runs the pure gates for a replayed record with no schema in front of it', async () => {
    const { ctx } = await setup()
    ctx.provide('evolutionState', {
      listPending: async () => [],
      savePending: async () => {},
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })
    await ctx.plugin(EvolutionApproval, { enabled: true })
    // The forged-record route: the runner executes STORED args with no schema in front.
    const missing = await ctx.evolutionApproval.run('skill', {
      operation: { action: 'patch', name: 'gate-replay', old_string: 'Body.' },
      origin: 'background_review',
      libraryOrigin: 'background_review',
    }, { interface: 'background_review' })
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('skill_manage patch requires new_string')
    const malformed = await ctx.evolutionApproval.run('skill', {
      operation: { action: 'create', name: 42, content: skillBody('gate-replay') },
      origin: 'background_review',
      libraryOrigin: 'background_review',
    }, { interface: 'background_review' })
    expect(malformed.ok).toBe(false)
    expect(malformed.message).toContain('"name" must be a string')
  })
})

describe('write gates: the foreground confirmation (E-317)', () => {
  interface AskedQuestion {
    id: string
    header?: string
    question: string
    options?: Array<{ label: string }>
  }

  /**
   * A stub question service: it records what the operator was asked and which agent the prompt was
   * routed through. `accept` reproduces the platform's identity check (throwing CALLER_NOT_LIVE for
   * anything but the exact live instance); a rejected prompt never reaches the human, so it is not
   * recorded.
   */
  function mountQuestions(
    ctx: Context,
    decide: (question: AskedQuestion) => string[],
    accept?: (agent: unknown) => boolean,
  ): { asked: AskedQuestion[]; routing: unknown[] } {
    const asked: AskedQuestion[] = []
    const routing: unknown[] = []
    ctx.provide('userQuestions', {
      ask: async (request: { questions: AskedQuestion[]; agent?: unknown }) => {
        if (accept !== undefined && !accept(request.agent)) {
          throw Object.assign(new Error('human interaction requires the exact live calling agent when an agent is supplied'), { code: 'CALLER_NOT_LIVE' })
        }
        const question = request.questions[0] as AskedQuestion
        asked.push(question)
        routing.push(request.agent)
        return { answers: [{ id: question.id, selected: decide(question) }] }
      },
    })
    return { asked, routing }
  }

  it('asks exactly once before a foreground create, and writes when confirmed', async () => {
    const { ctx, root } = await setup()
    const { asked, routing } = mountQuestions(ctx, () => ['Create'])
    const session = sessionOf(undefined)
    const created = await callTool(ctx, { action: 'create', name: 'confirm-yes', content: skillBody('confirm-yes') }, session)
    expect(valueOf(created).ok, valueOf(created).message).toBe(true)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.id).toBe('evolution-skill-write')
    expect(asked[0]?.options?.map(option => option.label)).toEqual(['Create', 'Cancel'])
    expect(asked[0]?.question).toContain('confirm-yes')
    // The prompt is routed through the CALLING agent (the platform's ask() takes an agent, not a
    // session), so assert the routing target is the one the call came from.
    expect((routing[0] as { session?: unknown }).session).toBe(session)
    expect(await readFile(skillPath(root, 'confirm-yes'), 'utf8')).toContain('Body.')
  })

  it('declines the write when the operator picks anything but the confirm label', async () => {
    const { ctx, root } = await setup()
    const { asked } = mountQuestions(ctx, () => ['Cancel'])
    const refused = await callTool(ctx, { action: 'create', name: 'confirm-no', content: skillBody('confirm-no') }, sessionOf(undefined))
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('E-317')
    expect(valueOf(refused).message).toContain('"confirm-no"')
    expect(asked).toHaveLength(1)
    expect(await readFile(skillPath(root, 'confirm-no'), 'utf8').catch(() => null)).toBeNull()
  })

  it('asks once for a bare delete and not for an absorbed one', async () => {
    const { ctx } = await setup()
    // Answer the FIRST option, i.e. the confirm label of whatever action is being confirmed.
    const { asked } = mountQuestions(ctx, question => [question.options?.[0]?.label ?? 'Cancel'])
    await createTarget(ctx, 'confirm-umbrella')
    await createTarget(ctx, 'confirm-absorbed')
    await createTarget(ctx, 'confirm-bare')
    expect(asked).toHaveLength(3)
    const absorbed = await callTool(ctx, { action: 'delete', name: 'confirm-absorbed', absorbed_into: 'confirm-umbrella' }, sessionOf(undefined))
    expect(valueOf(absorbed).ok, valueOf(absorbed).message).toBe(true)
    expect(asked).toHaveLength(3)
    const bare = await callTool(ctx, { action: 'delete', name: 'confirm-bare' }, sessionOf(undefined))
    expect(valueOf(bare).ok, valueOf(bare).message).toBe(true)
    expect(asked).toHaveLength(4)
    expect(asked[3]?.options?.map(option => option.label)).toEqual(['Delete', 'Cancel'])
  })

  it('does not ask a subagent, and does not ask on the replay path', async () => {
    const { ctx } = await setup()
    const { asked } = mountQuestions(ctx, () => ['Create'])
    const subagentCreate = await callTool(ctx, { action: 'create', name: 'confirm-subagent', content: skillBody('confirm-subagent') }, sessionOf('subagent'))
    expect(valueOf(subagentCreate).ok, valueOf(subagentCreate).message).toBe(true)
    expect(asked).toHaveLength(0)
    ctx.provide('evolutionState', {
      listPending: async () => [],
      savePending: async () => {},
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })
    await ctx.plugin(EvolutionApproval, { enabled: true })
    // The human release that staged the record IS the confirmation: a replay must not ask again.
    const replayed = await ctx.evolutionApproval.run('skill', {
      operation: { action: 'create', name: 'confirm-replay', content: skillBody('confirm-replay') },
      origin: 'foreground',
      libraryOrigin: 'foreground',
    }, { interface: 'background_review' })
    expect(replayed.ok, replayed.message).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it('refuses a malformed call before asking anything', async () => {
    const { ctx } = await setup()
    const { asked } = mountQuestions(ctx, () => ['Create'])
    const refused = await callTool(ctx, { action: 'create', name: 'confirm-missing' }, sessionOf(undefined))
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('skill_manage create requires content')
    expect(asked).toHaveLength(0)
  })

  it('proceeds with ONE warning when no question service is mounted', async () => {
    const { ctx } = await setup()
    const warns: string[] = []
    ctx.logger.warn = ((message: string) => { warns.push(message) }) as typeof ctx.logger.warn
    const first = await callTool(ctx, { action: 'create', name: 'confirm-noservice', content: skillBody('confirm-noservice') }, sessionOf(undefined))
    const second = await callTool(ctx, { action: 'create', name: 'confirm-noservice-2', content: skillBody('confirm-noservice-2') }, sessionOf(undefined))
    expect(valueOf(first).ok, valueOf(first).message).toBe(true)
    expect(valueOf(second).ok, valueOf(second).message).toBe(true)
    expect(warns.filter(message => message.includes('confirmation prompt'))).toHaveLength(1)
  })

  it('re-resolves the registry live root when the forwarded agent is not the live instance', async () => {
    const { ctx } = await setup()
    const sessionId = 'wg-confirm-live'
    const session = { id: sessionId, header: {}, snapshotEvents: () => [] }
    const live = { id: sessionId, session, ctx, inject: () => {} } as unknown as Agent
    ctx.agents.register(live)
    const { asked, routing } = mountQuestions(ctx, () => ['Create'], agent => agent === live)
    // A structural copy carrying the same session id: the platform rejects it as CALLER_NOT_LIVE,
    // so the gate has to route through the registry's live root instead.
    const forwarded = { id: sessionId, header: { origin: undefined }, snapshotEvents: () => [] }
    const created = await callTool(ctx, { action: 'create', name: 'confirm-live', content: skillBody('confirm-live') }, forwarded)
    expect(valueOf(created).ok, valueOf(created).message).toBe(true)
    expect(asked).toHaveLength(1)
    expect(routing[0]).toBe(live)
  })

  it('proceeds with a warning when the session has no live root agent', async () => {
    const { ctx } = await setup()
    const warns: string[] = []
    ctx.logger.warn = ((message: string) => { warns.push(message) }) as typeof ctx.logger.warn
    const { asked } = mountQuestions(ctx, () => ['Create'], () => false)
    const created = await callTool(ctx, { action: 'create', name: 'confirm-noroot', content: skillBody('confirm-noroot') }, sessionOf(undefined))
    expect(valueOf(created).ok, valueOf(created).message).toBe(true)
    expect(asked).toHaveLength(0)
    expect(warns.filter(message => message.includes('confirmation prompt'))).toHaveLength(1)
  })
})


describe('write gates: review-fix sentinels (2026-09-26 independent review)', () => {
  interface AskedQuestion {
    id: string
    header?: string
    question: string
    options?: Array<{ label: string }>
  }

  /** A question service whose answer depends on the question, so a delete answers "Delete". */
  function mountQuestions(ctx: Context, decide: (question: AskedQuestion) => string[]): { asked: AskedQuestion[] } {
    const asked: AskedQuestion[] = []
    ctx.provide('userQuestions', {
      ask: async (request: { questions: AskedQuestion[] }) => {
        const question = request.questions[0] as AskedQuestion
        asked.push(question)
        return { answers: [{ id: question.id, selected: decide(question) }] }
      },
    })
    return { asked }
  }

  const confirmLabelOf = (question: AskedQuestion): string => question.options?.[0]?.label ?? 'Cancel'

  it('asks for a delete whose absorbed_into is BLANK (a blank is a bare archive, not a merge)', async () => {
    const { ctx } = await setup()
    const { asked } = mountQuestions(ctx, question => [confirmLabelOf(question)])
    await createTarget(ctx, 'blank-absorb-source')
    await createTarget(ctx, 'blank-absorb-target')
    expect(asked).toHaveLength(2)
    // The archive call is truthiness-based, so a blank performs a BARE archive — it must not borrow
    // the merge exemption (review P1: the gate and the write disagreed about what blank means).
    const blank = await callTool(
      ctx,
      { action: 'delete', name: 'blank-absorb-target', absorbed_into: '   ' },
      sessionOf(undefined),
    )
    expect(asked).toHaveLength(3)
    expect(asked[2]?.options?.map(option => option.label)).toEqual(['Delete', 'Cancel'])
    // The confirmation ran and was accepted; the LIBRARY still refuses the blank umbrella name,
    // which is the outcome the gate's exemption would have hidden.
    expect(valueOf(blank).ok).toBe(false)
    expect(valueOf(blank).message).toContain('Invalid skill name')
  })

  it('refuses a DISMISSED prompt instead of writing unconfirmed (ASK_ABORTED)', async () => {
    const { ctx, root } = await setup()
    ctx.provide('userQuestions', {
      ask: async () => {
        throw Object.assign(new Error('ask_user_question was aborted before the user answered'), { code: 'ASK_ABORTED' })
      },
    })
    const refused = await callTool(ctx, { action: 'create', name: 'abort-create', content: skillBody('abort-create') }, sessionOf(undefined))
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('E-317')
    expect(await readFile(skillPath(root, 'abort-create'), 'utf8').catch(() => null)).toBeNull()
  })

  it('refuses a non-string action by name at the execution point, and lets a MISSING action reach the library', async () => {
    const { ctx } = await setup()
    // The tool schema is in front of the tool path, so the shape gate is driven through the
    // schema-less replay channel — the route a forged pending record takes (v21 R-2 keeps the
    // schema-bypassed route as the way to reach these gates at all).
    ctx.provide('evolutionState', {
      listPending: async () => [],
      savePending: async () => {},
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })
    await ctx.plugin(EvolutionApproval, { enabled: true })
    const replay = (operation: Record<string, unknown>) => ctx.evolutionApproval.run('skill', {
      operation,
      origin: 'background_review',
      libraryOrigin: 'background_review',
    }, { interface: 'background_review' })
    const garbage = await replay({ action: 42, name: 'garbage-action' })
    expect(garbage.ok).toBe(false)
    expect(garbage.message).toContain('"action" must be a string')
    await createTarget(ctx, 'missing-action')
    // An absent action is not a read-required write: the tool schema requires one, so the library
    // owns that refusal rather than the read gate sending the model to read a skill it cannot write.
    const absent = await replay({ name: 'missing-action' })
    expect(absent.ok).toBe(false)
    expect(absent.message).not.toContain('E-318')
  })
})
