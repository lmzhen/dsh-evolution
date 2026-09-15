import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import { SkillLibrary, loadUsage, nodeEvolutionIo, saveUsage } from '@deepseek-ai/dsh-evolution-core'
import * as Review from '../src/index.ts'

// v43 audit (FLOW4-2 / D-1): the review's approval-disabled DIRECT write path
// called skillUsage.record(name, 'patch') on any ok result — including a NO-OP
// update/patch, whose skill-store result is { ok: true, noop: true, 'nothing
// written' }. That bumped patch_count and refreshed last_patched_at, which feeds
// computeQualityScores' recency factor (idle < 30d => 1): a write that changed
// nothing pinned a dead skill as recently-touched for a month and suppressed the
// low-quality warn. The tool channel already guards on result.noop !== true.
const SKILL = (name: string): string =>
  '---\nname: ' + name + '\ndescription: ' + name + ' test skill.\n---\nBody of ' + name + '.\n'

describe('review direct-write usage accounting', () => {
  it('a no-op update reports no mutation: patch_count and last_patched_at stay untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-noop-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    let reviewFiber: { dispose(): Promise<void> } | undefined
    try {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      const library = new SkillLibrary(undefined, nodeEvolutionIo())
      await ctx.plugin(SkillUsageRegistry, { root: library.root })
      // CONTROL skill: a REAL content update must bump its counter — that is the
      // proof this fixture reaches the direct write path end to end.
      await library.create('real-change', SKILL('real-change'), 'foreground')
      // REGRESSION skill: the plan re-writes byte-identical content (no-op).
      await library.create('noop-change', SKILL('noop-change'), 'foreground')
      const seed = new Map(['real-change', 'noop-change'].map(name => [name, {
        created_by: null, created_at: new Date().toISOString(), use_count: 0, view_count: 0, patch_count: 0,
        last_used_at: null, last_viewed_at: null, last_patched_at: null,
        state: 'active', pinned: false, archived_at: null,
      }]))
      await saveUsage(library.root, seed as never, nodeEvolutionIo())

      ctx.provide('subagents', {
        start: async () => ({
          result: Promise.resolve({
            structured: {
              summary: 'touch two skills',
              skillOps: [
                { action: 'update', name: 'real-change', content: SKILL('real-change') + 'Extra paragraph.\n', evidence: [{ event_seq: 1 }] },
                { action: 'update', name: 'noop-change', content: SKILL('noop-change'), evidence: [{ event_seq: 1 }] },
              ],
            },
          }),
          localAgent: null,
          dispose: async () => {},
        }),
      })
      ctx.provide('evolutionPolicy', {
        get: () => ({ maxOpsPerPlan: 10, protectedSkillNames: [], skillContentChars: 100_000 }),
      })
      reviewFiber = await ctx.plugin(Review, {
        reviewEnabled: true,
        reviewMode: 'subagent',
        memoryInterval: 1,
        skillInterval: 1,
      })

      const session = ctx.sessions.create(SessionId('review-noop-session'))
      const agent = { id: session.id, session, ctx, inject: () => {} } as unknown as Agent
      ctx.agents.register(agent)
      session.append('turn/start', { turn: 1 })
      // Read-before-write: the background review may only write a skill the
      // parent session READ in this session.
      for (const name of ['real-change', 'noop-change']) {
        const callId = ToolCallId('read-' + name)
        session.append('tool/call', { turn: 1, step: 0, callId, name: 'skill', arguments: JSON.stringify({ name }) })
        session.append('tool/result', {
          turn: 1, step: 0,
          message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'skill loaded' }], isError: false }),
        }, { surfaceOp: 'append' })
      }
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Remember this preference and keep it. '.repeat(8) }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

      // The CONTROL write landing proves the plan loop ran; the regression skill
      // is the second op of the same sequential loop, so its op has executed too.
      await expect.poll(async () => (await loadUsage(library.root, nodeEvolutionIo())).get('real-change')?.patch_count, {
        timeout: 5000, interval: 50,
      }).toBe(1)
      const usage = await loadUsage(library.root, nodeEvolutionIo())
      expect(usage.get('noop-change')?.patch_count).toBe(0)
      expect(usage.get('noop-change')?.last_patched_at).toBeNull()
      // And the no-op really was a no-op on disk.
      expect(await library.read('noop-change')).toBe(SKILL('noop-change'))
    } finally {
      await reviewFiber?.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      for (let attempt = 0; ; attempt++) {
        try { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); break }
        catch (error) { if (attempt >= 5) throw error }
      }
    }
  })
})
