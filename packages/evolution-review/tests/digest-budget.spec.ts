// @vitest-environment node
/**
 * T3-08/A36: the digest window is sized by the data the review MUST see.
 *
 * `buildReviewRequest` used to slice the raw surface to `maxMessages` and only then keep the
 * user/assistant entries — so a tool-heavy tail produced a digest with no conversation at all.
 */
import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { buildReviewRequest } from '../src/index.ts'

const text = (value: string): Array<{ type: string; text: string }> => [{ type: 'text', text: value }]

describe('the review digest budget (T3-08/A36)', () => {
  it('keeps the user/assistant turns the review must see, even behind a long tool-heavy tail', () => {
    const surface = [
      { role: 'user', content: text('先把 X 做完') },
      { role: 'assistant', content: text('好') },
      ...Array.from({ length: 60 }, (_, index) => ({ role: 'tool', content: text('tool-' + String(index)) })),
    ]
    const session = { deriveMessages: () => surface } as unknown as Session
    const digest = buildReviewRequest(session, 'combined', { toolCalls: 0, userChars: 0, assistantChars: 0 }, 8, 500)
    // Both turns survive the window; the tool evidence still rides along.
    expect(digest).toContain('USER: 先把 X 做完')
    expect(digest).toContain('ASSISTANT: 好')
    expect(digest).toContain('Recent tool activity')
  })

  it('the window still bounds how many turns come through', () => {
    const surface = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: text('turn-' + String(index)),
    }))
    const session = { deriveMessages: () => surface } as unknown as Session
    const digest = buildReviewRequest(session, 'combined', { toolCalls: 0, userChars: 0, assistantChars: 0 }, 3, 500)
    expect(digest).toContain('turn-9')
    expect(digest).not.toContain('turn-6')
  })
})
