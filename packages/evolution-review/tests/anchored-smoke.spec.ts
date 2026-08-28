import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import { SkillLibrary, loadUsage, nodeEvolutionIo, saveUsage } from '@deepseek-ai/dsh-evolution-core'
import * as Review from '../src/index.ts'

const anchoredEntry = fileURLToPath(new URL('../../test-support/anchored-standard/tool-bootstrap.mjs', import.meta.url))
const Anchored = await import(pathToFileURL(anchoredEntry).href) as { apply(ctx: Context, config?: unknown): Promise<void> | void }

const SKILL = (name: string) => `---\nname: ${name}\ndescription: ${name} test skill.\n---\nBody of ${name}.\n`

describe('anchored-standard review smoke', () => {
  it('starts a review subagent with the anchored discovery tool set', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    // Real anchored-standard bootstrap plugin: mounted first, as in its preset.
    await ctx.plugin(Anchored, {
      bootstrapTools: ['bash', 'str_replace_editor'],
      promoteOn: 'either',
      suppressedContextSources: ['agent-instructions', 'skill-catalog'],
    })

    let capturedRequest: unknown
    ctx.provide('subagents', {
      start: async (_name: string, request: unknown) => {
        capturedRequest = request
        return {
          result: Promise.resolve({ structured: null }),
          dispose: async () => {},
        }
      },
    })

    await ctx.plugin(Review, {
      reviewEnabled: true,
      reviewMode: 'subagent',
      memoryInterval: 1,
      skillInterval: 1,
    })

    const session = ctx.sessions.create(SessionId('anchored-review-session'))
    const agent = {
      id: session.id,
      session,
      ctx,
      inject: () => {},
    } as unknown as Agent
    ctx.agents.register(agent)

    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{
        type: 'text',
        text: 'I prefer concise answers and want you to remember that preference. '.repeat(6),
      }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(capturedRequest).toBeDefined()
    const request = capturedRequest as Record<string, unknown> | undefined
    // The DSH tool catalog exposes `skill` only — discovery tools don't exist,
    // so the default allow list is exactly the real tool set.
    expect(request?.toolFilter).toEqual({ allow: ['skill'] })
    // No reviewProvider config: the subagent inherits the deployment default
    // route instead of a hardcoded provider name.
    expect((request?.agentOptions as Record<string, unknown> | undefined)?.provider).toBeUndefined()
    expect(typeof (request?.agentOptions as Record<string, unknown> | undefined)?.model).toBe('string')
  })

  it('direct delete path marks the usage record archived (G1, rc.39 audit §4-A)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-g1-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      // Real library: the review's executeSkillDirect archives against the
      // skills root under DSH_HOME, so seed the two skills the delete plan needs.
      const library = new SkillLibrary(undefined, nodeEvolutionIo())
      // The registry MUST use the same root as the library — the schemastery
      // default `root: ''` is NOT nullish, so `config.root ?? skillsRoot()`
      // keeps `''` and silently disconnects the registry (B7 lesson).
      await ctx.plugin(SkillUsageRegistry, { root: library.root })
      await library.create('survivor-skill', SKILL('survivor-skill'), 'foreground')
      await library.create('doomed-skill', SKILL('doomed-skill'), 'foreground')
      // The usage record is what the tool path would have written (record on
      // create); markArchived only transitions an EXISTING record, so seed it.
      await saveUsage(library.root, new Map([['doomed-skill', {
        created_by: null, created_at: new Date().toISOString(), use_count: 0, view_count: 0, patch_count: 0,
        last_used_at: null, last_viewed_at: null, last_patched_at: null,
        state: 'active', pinned: false, archived_at: null,
      }]]), nodeEvolutionIo())

      let capturedRequest: unknown
      ctx.provide('subagents', {
        start: async (_name: string, request: unknown) => {
          capturedRequest = request
          return {
            // The review plan: delete doomed-skill into the survivor umbrella.
            result: Promise.resolve({
              structured: {
                summary: 'consolidate the narrow skill',
                skillOps: [{
                  action: 'delete',
                  name: 'doomed-skill',
                  absorbed_into: 'survivor-skill',
                  evidence: [{ event_seq: 1 }],
                }],
              },
            }),
            localAgent: null,
            dispose: async () => {},
          }
        },
      })
      ctx.provide('evolutionPolicy', {
        get: () => ({ maxOpsPerPlan: 10, protectedSkillNames: [], skillContentChars: 100_000 }),
      })

      await ctx.plugin(Review, {
        reviewEnabled: true,
        reviewMode: 'subagent',
        memoryInterval: 1,
        skillInterval: 1,
      })

      const session = ctx.sessions.create(SessionId('review-g1-session'))
      const agent = {
        id: session.id,
        session,
        ctx,
        inject: () => {},
      } as unknown as Agent
      ctx.agents.register(agent)

      session.append('turn/start', { turn: 1 })
      // The parent session READ doomed-skill this session (read-before-write
      // mark for the background review guard).
      session.append('tool/call', {
        turn: 1,
        step: 0,
        callId: CallId('read-doomed-skill'),
        name: 'skill',
        arguments: JSON.stringify({ name: 'doomed-skill' }),
      })
      session.append('user/message', createUserMessage({
        content: [{
          type: 'text',
          text: 'I prefer concise answers and want you to remember that preference. '.repeat(6),
        }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      await new Promise(resolve => setTimeout(resolve, 100))
      expect(capturedRequest).toBeDefined()
      // The actual archive landed (schedule-review ran executePlan → direct path).
      expect((await library.list()).some(s => s.name === 'doomed-skill')).toBe(false)
      // In-memory registry view (what markArchived mutated — first signal).
      const registryReport = await (ctx.get('skillUsage') as { report(): Promise<Map<string, { state?: string; archived_at?: string | null; patch_count?: number }>> }).report()
      const memoryRecord = registryReport.get('doomed-skill')
      expect(memoryRecord?.state).toBe('archived')
      expect(memoryRecord?.archived_at).toBeTruthy()
      expect(memoryRecord?.patch_count).toBe(0)
      // G1 regression: the usage record must be archived like every other
      // delete path — otherwise the next curator run re-proposes the name and
      // errors forever ("not found" + failedFrom rollback).
      const usage = await loadUsage(library.root, nodeEvolutionIo())
      const record = usage.get('doomed-skill')
      expect(record?.state).toBe('archived')
      expect(record?.archived_at).toBeTruthy()
      expect(record?.patch_count).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(root, { recursive: true, force: true })
    }
  })
})
