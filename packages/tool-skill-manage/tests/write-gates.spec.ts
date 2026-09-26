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
