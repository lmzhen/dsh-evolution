/**
 * S2.2 (v37 P1-2): `skill_manage` reads the family review-channel mark.
 *
 * In the default 'inject' review channel the review prompt runs in the PARENT
 * session, whose header carries no origin, so the platform reported those
 * autonomous writes as 'foreground': a `.pinned` skill could be rewritten by
 * the review and a review-created skill never got its `.hermes-managed` mark.
 * The mark restores both, and only for the marked session.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as ToolSkillManage from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { clearReviewChannel, markReviewChannel } from '@deepseek-ai/dsh-evolution-core'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MARKED_SESSION = 's22-inject-review-session'
const PLAIN_SESSION = 's22-foreground-session'

function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} review channel probe.\n---\n\n${body}\n`
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-s22-review-channel-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(SkillUsageRegistry, { root })
  await ctx.plugin(ToolSkillManage)
  const run = (sessionId: string, args: Record<string, unknown>) => ctx.tools.execute({
    callId: ToolCallId(`s22-${sessionId}-${Math.random()}`),
    name: 'skill_manage',
    arguments: args,
    agent: { session: { id: sessionId, header: {} } } as unknown as Agent,
    signal: new AbortController().signal,
  })
  const messageOf = (result: { value?: unknown }): string => (result.value as { message?: string } | undefined)?.message ?? ''
  // A library-level refusal rides the structured payload: `ok: false` with the
  // reason in `message` (`isError` stays false — only a schema reject sets it).
  const okOf = (result: { value?: unknown }): boolean => (result.value as { ok?: boolean } | undefined)?.ok === true
  return {
    root,
    run,
    messageOf,
    okOf,
    cleanup: async () => {
      clearReviewChannel(MARKED_SESSION)
      clearReviewChannel(PLAIN_SESSION)
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

afterEach(() => {
  clearReviewChannel(MARKED_SESSION)
  clearReviewChannel(PLAIN_SESSION)
})

describe('review-channel origin (S2.2, v37 P1-2)', () => {
  it('an inject-mode review write cannot rewrite a pinned skill; a foreground write can', async () => {
    const { root, run, messageOf, okOf, cleanup } = await setup()
    try {
      const created = await run(PLAIN_SESSION, { action: 'create', name: 'pinned-skill', content: skill('pinned-skill', 'Body v1.') })
      expect(okOf(created), messageOf(created)).toBe(true)
      const pinned = await run(PLAIN_SESSION, { action: 'pin', name: 'pinned-skill' })
      expect(okOf(pinned), messageOf(pinned)).toBe(true)
      // Unmarked session: the user's own write still lands (foreground).
      const foreground = await run(PLAIN_SESSION, { action: 'update', name: 'pinned-skill', content: skill('pinned-skill', 'Body v2.') })
      expect(okOf(foreground), messageOf(foreground)).toBe(true)
      // Marked session = the review channel: refused, and nothing changed.
      markReviewChannel(MARKED_SESSION)
      const review = await run(MARKED_SESSION, { action: 'update', name: 'pinned-skill', content: skill('pinned-skill', 'Body v3.') })
      expect(okOf(review)).toBe(false)
      expect(messageOf(review)).toContain('protected (pinned)')
      expect(await readFile(join(root, 'skills', 'pinned-skill', 'SKILL.md'), 'utf8')).toContain('Body v2.')
      // A different, unmarked session is unaffected by the mark.
      const other = await run(PLAIN_SESSION, { action: 'update', name: 'pinned-skill', content: skill('pinned-skill', 'Body v4.') })
      expect(okOf(other), messageOf(other)).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('the mark covers the whole mutating surface: pin/unpin and support files too', async () => {
    const { run, messageOf, okOf, cleanup } = await setup()
    try {
      await run(PLAIN_SESSION, { action: 'create', name: 'frozen-skill', content: skill('frozen-skill', 'Body.') })
      await run(PLAIN_SESSION, { action: 'pin', name: 'frozen-skill' })
      markReviewChannel(MARKED_SESSION)
      // Pin/unpin is a protection mutation the autonomous channel may never make.
      const pin = await run(MARKED_SESSION, { action: 'pin', name: 'frozen-skill' })
      expect(okOf(pin)).toBe(false)
      expect(messageOf(pin)).toContain('Only the foreground')
      const unpin = await run(MARKED_SESSION, { action: 'unpin', name: 'frozen-skill' })
      expect(okOf(unpin)).toBe(false)
      expect(messageOf(unpin)).toContain('Only the foreground')
      // Support-file writes carry the same pinned guard as the body.
      const support = await run(MARKED_SESSION, { action: 'write_file', name: 'frozen-skill', file_path: 'references/a.md', file_content: 'draft' })
      expect(okOf(support)).toBe(false)
      expect(messageOf(support)).toContain('protected (pinned)')
    } finally {
      await cleanup()
    }
  })

  it('a real user message ends the window: the same session writes as foreground again', async () => {
    const { run, messageOf, okOf, cleanup } = await setup()
    try {
      await run(PLAIN_SESSION, { action: 'create', name: 'window-skill', content: skill('window-skill', 'Body v1.') })
      await run(PLAIN_SESSION, { action: 'pin', name: 'window-skill' })
      markReviewChannel(MARKED_SESSION)
      const review = await run(MARKED_SESSION, { action: 'update', name: 'window-skill', content: skill('window-skill', 'Body v2.') })
      expect(okOf(review)).toBe(false)
      expect(messageOf(review)).toContain('protected (pinned)')
      // The review plugin clears the mark on the next `{ kind: 'user' }` message.
      clearReviewChannel(MARKED_SESSION)
      const afterUser = await run(MARKED_SESSION, { action: 'update', name: 'window-skill', content: skill('window-skill', 'Body v3.') })
      expect(okOf(afterUser), messageOf(afterUser)).toBe(true)
      expect(messageOf(afterUser)).not.toContain('protected')
    } finally {
      await cleanup()
    }
  })

  it('a review-channel create is marked .hermes-managed, a foreground one is not', async () => {
    const { root, run, okOf, cleanup } = await setup()
    try {
      markReviewChannel(MARKED_SESSION)
      const reviewCreated = await run(MARKED_SESSION, { action: 'create', name: 'review-made', content: skill('review-made', 'Body.') })
      expect(okOf(reviewCreated)).toBe(true)
      expect(await readFile(join(root, 'skills', 'review-made', '.hermes-managed'), 'utf8')).toBe('')
      const userCreated = await run(PLAIN_SESSION, { action: 'create', name: 'user-made', content: skill('user-made', 'Body.') })
      expect(okOf(userCreated)).toBe(true)
      await expect(readFile(join(root, 'skills', 'user-made', '.hermes-managed'), 'utf8')).rejects.toThrow()
    } finally {
      await cleanup()
    }
  })
})
