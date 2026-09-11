import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import * as Review from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * V10-10 (P2-11) + V10-13 (P2-9) regression pins:
 * - P2-11: the `tool/result` evidence line must read the rc.2 payload shape
 *   (`message.content` tool-result blocks) — the former `data.output` read
 *   never matched, so every `[result]` line rendered an empty payload.
 * - P2-9: with `skillReviewTrigger: 'both'`, a completed turn served by the
 *   cadence flush must not ALSO fire the completion channel (double review).
 */

describe('V10-10 (P2-11): tool/result evidence extraction', () => {
  it('renders a non-empty [result] line from the rc.2 payload shape (message.content tool-result block)', () => {
    // Upstream shape (session/src/types.ts 'tool/result' + llm ToolResultBlock):
    // the payload text lives at message.content[i].content[j] (text blocks).
    const line = Review.renderToolResultLine({
      turn: 3,
      step: 2,
      message: {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'skill saved to disk' }] },
        ],
      },
    })
    expect(line.startsWith('[result]')).toBe(true)
    expect(line).toContain('skill saved to disk')
    expect(line).not.toContain('[ERROR]')
  })

  it('marks [ERROR] for the payload-level error and for a block-level isError', () => {
    const payloadError = Review.renderToolResultLine({
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'boom' }] }],
      },
      error: { name: 'ToolError', code: 'TOOL_ABORTED' },
    })
    expect(payloadError).toContain('[ERROR]')
    expect(payloadError).toContain('boom')
    const blockError = Review.renderToolResultLine({
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'failed' }] }],
      },
    })
    expect(blockError).toContain('[ERROR]')
    expect(blockError).toContain('failed')
  })

  it('keeps the legacy no-message shape tolerant: empty payload, never throws', () => {
    // The pre-rc.2 assumption (`data.output`) and a bare/absent payload must
    // degrade to an empty evidence line, not throw.
    expect(Review.renderToolResultLine({ output: 'legacy field is ignored' })).toBe('[result] ')
    expect(Review.renderToolResultLine(undefined)).toBe('[result] ')
    expect(() => Review.renderToolResultLine(null)).not.toThrow()
    expect(() => Review.renderToolResultLine({ message: { content: 'not-an-array' } })).not.toThrow()
  })

  it('keeps the 500-char per-line truncation budget unchanged', () => {
    const line = Review.renderToolResultLine({
      message: { content: [{ type: 'tool-result', toolCallId: 'c', content: [{ type: 'text', text: 'x'.repeat(2000) }] }] },
    })
    expect(line.length).toBe('[result] '.length + 500)
  })
})

describe('V10-13 (P2-9): skillReviewTrigger both — one review per completed turn', () => {
  it('a completed turn served by the cadence flush does not ALSO inject the completion review', async () => {
    const delivered: string[] = []
    const collect = (message: unknown): void => {
      const box = message as { content?: Array<{ type: string; text: string }> } | null
      delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
    }
    // 1 tool/call on the turn: cadence fires (interval 1) AND the completion
    // long-session gate (min 1) is satisfied on the SAME completed boundary.
    const { ctx, emitEnd } = await mountReviewFixture({ onInject: collect, onFollowup: collect })
    ctx.provide('evolutionPolicy', { get: () => reviewPolicy() })
    await ctx.plugin(Review, {
      reviewEnabled: true,
      memoryInterval: 1,
      skillInterval: 1,
      reviewMode: 'inject',
      skillReviewTrigger: 'both',
      skillReviewCompletionMinToolCalls: 1,
    })
    emitEnd(1)
    // v21 (T-7): waitFor instead of a fixed 50ms window — under load the
    // (single) delivery may land late, and a mutex regression whose second
    // injection arrives after the window used to pass silently.
    await vi.waitFor(() => {
      // Exactly ONE review reached the model, and it is the cadence prompt —
      // not the completion channel's "task complete" variant.
      expect(delivered).toHaveLength(1)
    })
    expect(delivered[0]).toContain('[Auto-review')
    expect(delivered[0]).not.toContain('task complete')
  })

  it('a completed turn WITHOUT a due cadence flush still runs the completion review (no starvation)', async () => {
    const delivered: string[] = []
    const collect = (message: unknown): void => {
      const box = message as { content?: Array<{ type: string; text: string }> } | null
      delivered.push(typeof message === 'object' && box?.content?.[0] ? box.content[0].text : '')
    }
    // Huge cadence intervals (no flush due) + 25 tool calls: the completion
    // channel alone must still fire on the completed boundary — the mutex may
    // only suppress the turn the flush actually served.
    const toolCalls = Array.from({ length: 25 }, (_, i) => ({
      type: 'tool/call' as const,
      data: { turn: 1, step: i + 2, callId: `c${i}`, name: 'skill', arguments: '{}' },
    }))
    const { ctx, emitEnd } = await mountReviewFixture({ onInject: collect, onFollowup: collect, events: toolCalls })
    ctx.provide('evolutionPolicy', { get: () => ({ ...reviewPolicy(), reviewMemoryInterval: 1_000_000, reviewSkillInterval: 1_000_000 }) })
    await ctx.plugin(Review, {
      reviewEnabled: true,
      memoryInterval: 1_000_000,
      skillInterval: 1_000_000,
      reviewMode: 'inject',
      skillReviewTrigger: 'both',
      skillReviewCompletionMinToolCalls: 20,
    })
    emitEnd(1)
    // v21 (T-7): waitFor (see the test above) instead of a fixed 50ms sleep.
    await vi.waitFor(() => {
      expect(delivered).toHaveLength(1)
    })
    expect(delivered[0]).toContain('task complete')
  })
})

describe('V10-11 (P2-7): review skillsRoot config channel', () => {
  it('a review skill create lands in the configured skillsRoot, not the default tree', async () => {
    const skillsRoot = await mkdtemp(join(tmpdir(), 'v10-review-root-'))
    const { ctx, emitEnd } = await mountReviewFixture()
    ctx.provide('subagents', {
      start: async () => ({
        result: Promise.resolve({
          structured: {
            memoryOps: [],
            skillOps: [{
              action: 'create',
              name: 'rooted-skill',
              content: '---\nname: rooted-skill\ndescription: configured root pin.\n---\n\nRooted body.\n',
              evidence: [{ event_seq: 0 }],
            }],
            summary: 'create a skill in the configured root',
          },
        }),
        dispose: async () => {},
      }),
    })
    ctx.provide('memory', { applyBatch: async () => ({ ok: true, message: 'ok' }) })
    // 'subagent' mode (like review.spec): the provided subagents.start returns
    // the structured plan and the flush executes it — inject mode would only
    // inject a prompt and never run a plan in this fixture.
    ctx.provide('evolutionPolicy', { get: () => ({ ...reviewPolicy(), reviewMode: 'subagent' as const }) })
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    await ctx.plugin(Review, { reviewEnabled: true, memoryInterval: 1, skillInterval: 1, reviewMode: 'subagent', root: skillsRoot })
    emitEnd(1) // completed boundary: the flush executes the plan directly
    // Real fs writes + full-suite parallel load: give the create generous
    // room (the default 1s waitFor flaked under load).
    await vi.waitFor(() => {
      expect(existsSync(join(skillsRoot, 'rooted-skill', 'SKILL.md'))).toBe(true)
    }, { timeout: 15_000 })
    await rm(skillsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
})

/** Minimal single-session fixture (same shape as review.spec's mountReviewFixture). */
async function mountReviewFixture(options: {
  onInject?: (message: unknown) => void
  onFollowup?: (message: unknown) => void
  events?: Array<Record<string, unknown>>
} = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const session = {
    id: SessionId('v10-review-fixture'),
    seq: 1,
    header: { origin: undefined },
    events: [
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{}' } },
      ...(options.events ?? []),
    ],
    deriveMessages: (): Array<{ role: string; content: Array<{ type: string; text: string }> }> => [],
  } as unknown as Session
  const agent = { id: session.id, session, inject: (message: unknown) => { options.onInject?.(message) } } as unknown as Agent
  ;(agent as { followup: unknown }).followup = (message: unknown) => { options.onFollowup?.(message) }
  ctx.agents.register(agent)
  const emitEnd = (turn: number, reasonKind: 'completed' | 'blocked' = 'completed'): void => {
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn, reason: { kind: reasonKind } } } as never)
  }
  return { ctx, session, emitEnd }
}

/** Policy fake: the single tool/call is substantive; cadence intervals come from overrides. */
function reviewPolicy() {
  return {
    reviewMode: 'inject' as const,
    substantiveMinToolCalls: 1,
    substantiveMinUserChars: 0,
    substantiveMinAgentChars: 0,
    reviewMemoryInterval: 1,
    reviewSkillInterval: 1,
    maxOpsPerPlan: 5,
    protectedSkillNames: [] as string[],
    memoryChars: 10_000,
    userChars: 10_000,
    skillContentChars: 10_000,
    memoryReviewModel: 'model-x',
    skillReviewModel: 'model-x',
  }
}
