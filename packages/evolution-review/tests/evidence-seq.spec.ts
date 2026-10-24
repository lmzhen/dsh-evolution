// @tier ci-only
import { describe, expect, it } from 'vitest'
import * as Review from '../src/index.ts'

/**
 * Evidence-citation contract: every op the reviewer emits carries
 * `evidence: [{ seq }]`, and the validator accepts it only when that seq is an
 * integer within [0, sessionSeq] (evolution-plan-validator EVIDENCE_RANGE).
 *
 * Before this fix the digest dropped `event.seq` at `appendDispatchFrame` and
 * `renderToolResultLine` rendered `[result]` lines without one, so the rendered
 * request contained no seq anywhere. A reviewer could only invent a number, and
 * every op was rejected with "evidence is required and must reference a valid
 * session seq" — 132 consecutive reviews produced zero applied ops.
 *
 * These specs pin the two halves that make the contract satisfiable: the seq
 * survives the digest fold, and it reaches the rendered line.
 */

describe('evidence seq reaches the rendered request', () => {
  it('prefixes a [call] line with seq=<n>', () => {
    const digest = Review.buildReviewRequest(
      // buildReviewRequest only reads deriveMessages() off the session, so a
      // minimal double keeps this spec independent of the projection registry.
      { deriveMessages: () => [] } as never,
      'combined',
      { toolCalls: 1, userChars: 0, assistantChars: 0 },
      10,
      2_000,
      [{ type: 'tool/call', seq: 871, data: { callId: 'c1', name: 'pwsh', arguments: '{"command":"echo hi"}' } }],
    )
    expect(digest).toContain('seq=871 [call] pwsh')
  })

  it('prefixes a [result] line with seq=<n>', () => {
    const digest = Review.buildReviewRequest(
      { deriveMessages: () => [] } as never,
      'combined',
      { toolCalls: 1, userChars: 0, assistantChars: 0 },
      10,
      2_000,
      [{
        type: 'tool/result',
        seq: 873,
        data: {
          name: 'pwsh',
          arguments: '{"command":"dir"}',
          message: {
            role: 'tool',
            content: [
              { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'listing' }] },
            ],
          },
        },
      }],
    )
    expect(digest).toContain('seq=873 [result]')
  })

  it('renders the seq through renderToolResultLine directly', () => {
    const line = Review.renderToolResultLine(
      {
        message: {
          role: 'tool',
          content: [
            { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
          ],
        },
      },
      { name: 'pwsh', argsRaw: '{}' },
      42,
    )
    expect(line.startsWith('seq=42 [result]')).toBe(true)
  })

  it('omits the tag when the frame carries no seq (a stub session)', () => {
    const line = Review.renderToolResultLine({
      message: {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
      },
    })
    expect(line.startsWith('[result]')).toBe(true)
    expect(line).not.toContain('seq=')
  })

  it('states the evidence shape and the near-miss field names in the request', () => {
    const digest = Review.buildReviewRequest(
      { deriveMessages: () => [] } as never,
      'combined',
      { toolCalls: 0, userChars: 0, assistantChars: 0 },
      10,
      2_000,
      [],
    )
    // The contract lines: a plan that omits the shape is the failure this fixes.
    expect(digest).toContain('memoryOps')
    expect(digest).toContain('skillOps')
    expect(digest).toContain('"evidence": [{"seq": <n>}]')
    expect(digest).toContain('target: "memory" | "user"')
    expect(digest).toContain('name: the skill name')
    // The frontmatter requirement that used to lose whole create ops.
    expect(digest).toContain('YAML frontmatter')
  })
})
