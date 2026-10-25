// @tier pre-tag
import { expect, it } from 'vitest'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { makeV4Home, v3Row } from './support/schema4-home.ts'
import { runApproveCommand } from '../src/approve-command.ts'
import { runResumeCommand } from '../src/resume-command.ts'
import { createMergeCommand } from '../src/merge-command.ts'
import { createMergeRuntime, type MergeRuntimeDeps, type SkillCard } from '../src/index.ts'
import { commandError, formatMergeError } from '../src/domain/errors.ts'

const DECISION = { shouldMerge: true as const, mode: 'merge-into-existing' as const, target: 'a', sources: ['b'], rationale: 'r' }
const registry = {
  async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 1 } },
  async stage() {},
  async settle() {},
  runs() { return [] },
  find() { return undefined },
  cancel() { return false },
  cancelAll() { return 0 },
} as unknown as MergeRuntimeDeps['registry']
const lines = (text: string) => text.split('\n')

it('approve separates no-agent from missing parent and renders code/hint/next', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p1', state: 'pending', target: 'a', decision: DECISION } as never)])
  const ports = { async round2() { return { kind: 'failed' as const } } }
  const agentless = await runApproveCommand({ io: v4.io, home: v4.home, registry, ports: ports as never, rowId: 'p1', platformWrite: false, now: () => 1, agentless: true })
  expect(agentless.ok).toBe(false)
  if (!agentless.ok) {
    expect(lines(agentless.message)).toHaveLength(3)
    expect(agentless.message).toContain('code: e-305')
    expect(agentless.message).toContain('hint: E-305')
    expect(agentless.message).toContain('next: ')
  }
  const parentOnly = await runApproveCommand({ io: v4.io, home: v4.home, registry, ports: ports as never, rowId: 'p1', platformWrite: false, now: () => 1 })
  expect(parentOnly.ok).toBe(false)
  if (!parentOnly.ok) {
    expect(lines(parentOnly.message)).toHaveLength(3)
    expect(parentOnly.message).toContain('code: merge-parent-required')
    expect(parentOnly.message).toContain('E-305')
    expect(parentOnly.message).not.toContain('code: e-305')
  }
})

it('no-agent wins when a parent run id exists: the invocation itself is session-less', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p2', state: 'pending', target: 'a', decision: DECISION, runId: 'parent-run' } as never)])
  const result = await runApproveCommand({ io: v4.io, home: v4.home, registry, ports: { async round2() { return { kind: 'failed' as const } } } as never, rowId: 'p2', platformWrite: false, now: () => 1, agentless: true })
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.message).toContain('code: e-305')
    expect(result.message).not.toContain('code: merge-parent-required')
  }
})

it('resume separates no-agent from missing parent', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'f1', state: 'fuse', target: 'a', decision: DECISION } as never)])
  const ports = { screening: async () => [], round1: async () => ({ kind: 'failed' as const }), round2: async () => ({ kind: 'failed' as const }) }
  const agentless = await runResumeCommand({ io: v4.io, home: v4.home, registry, ports: ports as never, rowId: 'f1', platformWrite: false, now: () => 1, agentless: true })
  expect(agentless.ok).toBe(false)
  if (!agentless.ok) expect(agentless.message).toContain('code: e-305')
  const parentOnly = await runResumeCommand({ io: v4.io, home: v4.home, registry, ports: ports as never, rowId: 'f1', platformWrite: false, now: () => 1 })
  expect(parentOnly.ok).toBe(false)
  if (!parentOnly.ok) {
    expect(parentOnly.message).toContain('code: merge-parent-required')
    expect(parentOnly.message).not.toContain('code: e-305')
  }
})

const cards: SkillCard[] = [
  { name: 'a', description: 'a', body: 'body', managed: true },
  { name: 'b', description: 'b', body: 'body', managed: true },
]
function runtime(home: string, io: Awaited<ReturnType<typeof makeV4Home>>['io']): ReturnType<typeof createMergeRuntime> {
  const deps: MergeRuntimeDeps = {
    io, home, registry, skills: {} as SkillLibrary, now: () => 1,
    params: { mergeApproval: true, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 },
    platformWrite: false,
    channel: { open: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), continueTurn: async () => ({ kind: 'unavailable' as const, code: 'x', reason: 'x' }), dispose: async () => {} },
    parent: {}, allow: [], timeoutMinutes: 0,
    cards: async () => cards, screeningForRun: async () => [],
  }
  return createMergeRuntime(deps)
}

it('routes the runtime no-agent shape to code no-agent and missing parent to merge-parent-required', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p1', state: 'pending', target: 'a', decision: DECISION } as never)])
  const service = runtime(v4.home, v4.io)
  const agentless = await service.execute({ verb: 'approve', id: 'p1' }, { agentless: true })
  expect(agentless.ok).toBe(false)
  expect(agentless.text).toContain('code: e-305')
  const parentOnly = await service.execute({ verb: 'approve', id: 'p1' })
  expect(parentOnly.ok).toBe(false)
  expect(parentOnly.text).toContain('code: merge-parent-required')
})

it('every failing runtime verb answers exactly three code/hint/next lines', async () => {
  const v4 = await makeV4Home([])
  const service = runtime(v4.home, v4.io)
  const failures = [
    await service.execute({ verb: 'status', id: 'missing' }),
    await service.execute({ verb: 'report', id: 'missing' }),
    await service.execute({ verb: 'cancel', id: 'missing' }),
    await service.execute({ verb: 'reject', id: 'missing' }),
    await service.execute({ verb: 'discard', id: 'missing' }),
    await service.execute({ verb: 'resume', id: 'missing' }),
    await service.execute({ verb: 'resume' }),
    await service.execute({ verb: 'skipped', restore: 'missing' }),
    await service.execute({ verb: 'undo', target: 'a', run: 'missing' }),
    await service.execute({ verb: 'approve', id: 'missing' }),
    await service.execute({ verb: 'pair', a: 'a', b: 'a' }),
  ]
  for (const result of failures) {
    expect(result.ok).toBe(false)
    expect(lines(result.text), result.text).toHaveLength(3)
    expect(result.text.startsWith('code: ')).toBe(true)
    expect(result.text.split('\n')[1]?.startsWith('hint: ')).toBe(true)
    expect(result.text.split('\n')[2]?.startsWith('next: ')).toBe(true)
  }
})

it('collapses a multi-line upstream message into exactly three lines', () => {
  const formatted = formatMergeError(commandError('undo', 'undo-failed', 'first\nsecond\r\nthird', 'next step'))
  expect(formatted.split('\n')).toHaveLength(3)
  expect(formatted).toContain('hint: first second third')
})

it('carries stage and run id in the code line when they exist', () => {
  const text = formatMergeError(commandError('approve', 'target-taken', '目标在决策后变化', '重新 pair', 'run-9'))
  expect(text.split('\n')).toHaveLength(3)
  expect(text).toContain('code: target-taken (stage=approve, run=run-9)')
})

it('passes agentless through the command runner instead of faking a parent', async () => {
  const seen: unknown[] = []
  const command = createMergeCommand({ async execute(_command, context) { seen.push(context); return { ok: true, text: 'ok' } } })
  await command.handler({ rawInput: 'status' })
  await command.handler({ rawInput: 'status', agent: { session: 's1' } })
  expect(seen).toEqual([{ agentless: true }, { parent: { session: 's1' } }])
})
