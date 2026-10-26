// @tier ci-only
// @vitest-environment node
/**
 * PR #1 root fix: evidence must be citable from the digest, and the prompt must state
 * the exact op contract the validator enforces. Both halves are pinned together here.
 */
import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { planContractPrompt, validateEvolutionPlan } from '@deepseek-ai/dsh-evolution-plan-validator'
import { buildReviewRequest, noticeAllowed } from '../src/index.ts'

const session = { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'review me' }] }] } as unknown as Session
const call = { type: 'tool/call', seq: 42, data: { turn: 1, step: 0, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } }
const resultOnly = { type: 'tool/result', seq: 43, data: { message: { source: { callId: 'c2' }, content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'ok' }] }] } } }

describe('review evidence contract', () => {
  it('renders the frame seq on both call and result lines', () => {
    const request = buildReviewRequest(session, 'combined', { toolCalls: 1, userChars: 0, assistantChars: 0 }, 8, 500, [call, resultOnly])
    expect(request).toContain('seq=42 [call]')
    expect(request).toContain('seq=43 [result]')
  })

  it('makes the rendered seq a valid evidence citation', () => {
    const request = buildReviewRequest(session, 'combined', { toolCalls: 1, userChars: 0, assistantChars: 0 }, 8, 500, [call])
    const seq = Number(/seq=(\d+) \[call\]/.exec(request)?.[1])
    expect(Number.isInteger(seq)).toBe(true)
    const validated = validateEvolutionPlan({
      memoryOps: [{ action: 'add', target: 'memory', facts: 'x', evidence: [{ event_seq: seq }] }],
    }, { sessionSeq: 100 })
    expect(validated.ok).toBe(true)
  })

  it('never suppresses a review prompt when result notices are off', () => {
    expect(noticeAllowed(true, false)).toBe(true)
    expect(noticeAllowed(false, false)).toBe(false)
    expect(noticeAllowed(false, true)).toBe(true)
  })

  it('states every skill action field the validator requires', () => {
    const contract = planContractPrompt()
    for (const field of ['name', 'content', 'old_string', 'new_string', 'file_path', 'file_content']) {
      expect(contract).toContain(field)
    }
    expect(contract).toContain('event_seq')
    expect(contract).toContain('memory|user')
  })
})