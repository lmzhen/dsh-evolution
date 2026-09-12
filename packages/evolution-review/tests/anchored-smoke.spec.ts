import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
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
import { SkillLibrary, contentHash, loadUsage, nodeEvolutionIo, saveUsage } from '@deepseek-ai/dsh-evolution-core'
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
    // V6-53 (0.3.39): the threshold turn only STASHES the kind —the review
    // subagent starts at the NEXT completed boundary (the flush).
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    const deadline = Date.now() + 5000
    while (capturedRequest === undefined && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(capturedRequest).toBeDefined()
    const request = capturedRequest as Record<string, unknown> | undefined
    // The DSH tool catalog exposes `skill` only —discovery tools don't exist,
    // so the default allow list is exactly the real tool set.
    expect(request?.toolFilter).toEqual({ allow: ['skill'] })
    // No reviewProvider config: the subagent inherits the deployment default
    // route instead of a hardcoded provider name.
    expect((request?.agentOptions as Record<string, unknown> | undefined)?.provider).toBeUndefined()
    expect(typeof (request?.agentOptions as Record<string, unknown> | undefined)?.model).toBe('string')
    // P2-9 contract pin (corrected after the 0.3.1 real-run SubagentDepthError):
    // request.maxDepth is the ABSOLUTE cap on the child's own depth
    // (resolveChildDepth throws when parentDepth+1 > maxDepth). 1 permits the
    // review subagent itself while denying nesting (2 > 1); 0 rejects the
    // spawn outright. The structured-output contract is an object whose array
    // nodes carry NO items type —V8-01 (0.3.45): `items: { type: 'json' }`
    // is a defineTool DSL value that the raw assertObjectJsonSchema boundary
    // rejects (every spawn failed and silently degraded to inject).
    expect(request?.maxDepth).toBe(1)
    const outputSchema = request?.outputSchema as {
      type?: string
      properties?: Record<string, { type?: string; items?: { type?: string } }>
    } | undefined
    expect(outputSchema?.type).toBe('object')
    expect(outputSchema?.properties?.memoryOps?.type).toBe('array')
    expect(outputSchema?.properties?.skillOps?.type).toBe('array')
    expect(outputSchema?.properties?.memoryOps?.items).toBeUndefined()
    expect(outputSchema?.properties?.skillOps?.items).toBeUndefined()
  })

  it('direct delete path marks the usage record archived (G1, rc.39 audit 搂4-A)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-g1-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    let reviewFiber: { dispose(): Promise<void> } | undefined
    try {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      // Real library: the review's executeSkillDirect archives against the
      // skills root under DSH_HOME, so seed the two skills the delete plan needs.
      const library = new SkillLibrary(undefined, nodeEvolutionIo())
      // The registry MUST use the same root as the library —the schemastery
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

      reviewFiber = await ctx.plugin(Review, {
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
      // v32 REV-06(a): the read counts only with its paired SUCCESSFUL
      // tool/result (a call without a result is a failed read and must gate
      // the write) —the fixture under-pinned the session before this.
      session.append('tool/result', {
        turn: 1,
        step: 0,
        message: createToolResultMessage({ callId: CallId('read-doomed-skill'), content: [{ type: 'text', text: 'skill loaded' }], isError: false }),
      }, { surfaceOp: 'append' })
      session.append('user/message', createUserMessage({
        content: [{
          type: 'text',
          text: 'I prefer concise answers and want you to remember that preference. '.repeat(6),
        }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      // V6-53 (0.3.39): the threshold turn only STASHES the kind —the review
      // subagent starts at the NEXT completed boundary (the flush).
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

      // P2-14 (v11): the schedule is EVENT-DRIVEN (no 1ms timer exists in
      // this package —the old "fires on a 1ms interval" note described a
      // removed scheduler). The plan applies asynchronously: a fixed sleep
      // could snapshot the window where the disk archive landed but
      // markArchived has not run yet (observed once in the full parallel
      // suite). Poll each contract signal instead —the contract is final
      // consistency.
      await expect.poll(() => capturedRequest !== undefined, { timeout: 3000, interval: 50 }).toBe(true)
      // The actual archive landed (schedule-review ran executePlan 鈫?direct path).
      await expect.poll(async () => (await library.list()).some(s => s.name === 'doomed-skill'), { timeout: 3000, interval: 50 }).toBe(false)
      // In-memory registry view (what markArchived mutated —first signal).
      const memory = ctx.get('skillUsage') as { report(): Promise<Map<string, { state?: string; archived_at?: string | null; patch_count?: number }>> }
      await expect.poll(async () => (await memory.report()).get('doomed-skill')?.state, { timeout: 3000, interval: 50 }).toBe('archived')
      const registryReport = await memory.report()
      const memoryRecord = registryReport.get('doomed-skill')
      expect(memoryRecord?.archived_at).toBeTruthy()
      expect(memoryRecord?.patch_count).toBe(0)
      // G1 regression: the usage record must be archived like every other
      // delete path —otherwise the next curator run re-proposes the name and
      // errors forever ("not found" + failedFrom rollback).
      await expect.poll(async () => (await loadUsage(library.root, nodeEvolutionIo())).get('doomed-skill')?.state, { timeout: 3000, interval: 50 }).toBe('archived')
      const usage = await loadUsage(library.root, nodeEvolutionIo())
      const record = usage.get('doomed-skill')
      expect(record?.archived_at).toBeTruthy()
      expect(record?.patch_count).toBe(0)
    } finally {
      // Stop the 1ms review timer before removing the temp DSH_HOME: it keeps
      // writing sidecars and can otherwise race the recursive rm with an
      // ENOTEMPTY on Windows (observed once in the full parallel suite).
      await reviewFiber?.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      for (let attempt = 0; ; attempt++) {
        try {
          await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
          break
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (attempt >= 3 || (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM')) throw error
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
    }
  })
})

describe('v32 TEST-01/05: direct-path staleness and protected gates', () => {
  it('TEST-01: a stale-anchored update is refused on the direct path; a matching anchor applies', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-stale-'))
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
      await library.create('target-skill', SKILL('target-skill'), 'foreground')
      let capturedRequest: unknown
      const activePlan: unknown = {
        summary: 'update target skill',
        skillOps: [{
          action: 'update',
          name: 'target-skill',
          content: SKILL('target-skill').replace('Body of', 'Updated body of'),
          staged_from_sha256: contentHash('stale-bytes'),
          evidence: [{ event_seq: 1 }],
        }],
      }
      ctx.provide('subagents', {
        // v32 REV-06(b): the stub plays the CONCURRENT WRITER —while the
        // review subagent "runs", it edits the target skill. The plan (authored
        // against the pre-run snapshot) must then be refused as stale.
        start: async (_name: string, request: unknown) => {
          capturedRequest = request
          await library.update('target-skill', SKILL('target-skill').replace('Body of', 'Concurrently edited body of'), 'foreground')
          return {
            result: Promise.resolve({ structured: activePlan }),
            localAgent: null,
            dispose: async () => {},
          }
        },
      })
      reviewFiber = await ctx.plugin(Review, {
        reviewEnabled: true,
        reviewMode: 'subagent',
        memoryInterval: 1,
        skillInterval: 1,
      })
      const session = ctx.sessions.create(SessionId('stale-session'))
      const agent = { id: session.id, session, ctx, inject: () => {} } as unknown as Agent
      ctx.agents.register(agent)
      session.append('turn/start', { turn: 1 })
      session.append('tool/call', {
        turn: 1, step: 0, callId: CallId('read-target'),
        name: 'skill', arguments: JSON.stringify({ name: 'target-skill' }),
      })
      session.append('tool/result', {
        turn: 1, step: 0,
        message: createToolResultMessage({ callId: CallId('read-target'), content: [{ type: 'text', text: 'skill loaded' }], isError: false }),
      }, { surfaceOp: 'append' })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Please improve the target skill. '.repeat(12) }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      await expect.poll(() => capturedRequest !== undefined, { timeout: 10000, interval: 50 }).toBe(true)
      // The concurrent writer's bytes WIN; the plan's stale update is refused.
      await expect.poll(async () => (await library.read('target-skill'))?.includes('Concurrently edited body of'), { timeout: 3000, interval: 50 }).toBe(true)
      expect((await library.read('target-skill'))?.includes('Updated body of')).toBe(false)
    } finally {
      await reviewFiber?.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
  it('TEST-05: a plan landing on a skill the CURRENT policy protects is refused on the direct path', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-prot-'))
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
      await library.create('guarded-skill', SKILL('guarded-skill'), 'foreground')
      // Stateful policy: validation (call 1) sees an EMPTY list; execution
      // (call 2, executeSkillDirect re-reads) sees the skill now protected —
      // the policy-changed-between-validate-and-execute shape the direct-path
      // gate exists for.
      let policyCalls = 0
      ctx.provide('evolutionPolicy', {
        get: () => {
          policyCalls += 1
          return policyCalls <= 1
            ? { maxOpsPerPlan: 10, protectedSkillNames: [] as readonly string[], skillContentChars: 100_000 }
            : { maxOpsPerPlan: 10, protectedSkillNames: ['guarded-skill'] as readonly string[], skillContentChars: 100_000 }
        },
      })
      ctx.provide('subagents', {
        start: async () => {
          return {
            result: Promise.resolve({
              structured: {
                summary: 'update guarded skill',
                skillOps: [{
                  action: 'update',
                  name: 'guarded-skill',
                  content: SKILL('guarded-skill').replace('Body of', 'Updated body of'),
                  staged_from_sha256: contentHash(SKILL('guarded-skill')),
                  evidence: [{ event_seq: 1 }],
                }],
              },
            }),
            localAgent: null,
            dispose: async () => {},
          }
        },
      })
      reviewFiber = await ctx.plugin(Review, {
        reviewEnabled: true,
        reviewMode: 'subagent',
        memoryInterval: 1,
        skillInterval: 1,
      })
      const session = ctx.sessions.create(SessionId('prot-session'))
      const agent = { id: session.id, session, ctx, inject: () => {} } as unknown as Agent
      ctx.agents.register(agent)
      session.append('turn/start', { turn: 1 })
      session.append('tool/call', {
        turn: 1, step: 0, callId: CallId('read-guarded'),
        name: 'skill', arguments: JSON.stringify({ name: 'guarded-skill' }),
      })
      session.append('tool/result', {
        turn: 1, step: 0,
        message: createToolResultMessage({ callId: CallId('read-guarded'), content: [{ type: 'text', text: 'skill loaded' }], isError: false }),
      }, { surfaceOp: 'append' })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Please improve the guarded skill. '.repeat(6) }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      await expect.poll(async () => (await library.read('guarded-skill'))?.includes('Updated body of'), { timeout: 3000, interval: 50 }).toBe(false)
      expect((await library.read('guarded-skill'))?.includes('Body of guarded-skill')).toBe(true)
      // The refusal may have happened at plan validation or the direct-path
      // gate - either way the body must be unchanged.
    } finally {
      await reviewFiber?.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  // v33 F-4 (corrected): the pre-run baseline refresh. TESTS 06 and 07 are a
  // PAIR over the SAME fixture: the plan carries two `update` ops on ONE
  // skill, and the only difference is whether a concurrent writer lands
  // between them. TEST-06 pins that the refresh does not refuse op 2 (the
  // false-stale direction); TEST-07 pins that it does not bless op 2 over the
  // concurrent writer's bytes (the clobber direction). Neither direction is
  // reachable with a single-op plan.
  const runTwoOpPlan = async (
    name: string,
    homePrefix: string,
    betweenOps: ((library: SkillLibrary) => Promise<void>) | undefined,
  ): Promise<{ first: string; second: string; landed: string | null }> => {
    const root = await mkdtemp(join(tmpdir(), homePrefix))
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
      await library.create(name, SKILL(name), 'foreground')
      let capturedRequest: unknown
      // The review schedule snapshots the tree hash BEFORE subagents.start.
      // The two ops carry NO staged_from_sha256, so the only thing that can
      // refuse op 2 is the pre-run baseline — exactly the REV-06(b) surface.
      const first = SKILL(name).replace('Body of', 'First body of')
      const second = SKILL(name).replace('Body of', 'Second body of')
      const plan: unknown = {
        summary: 'update the skill twice',
        skillOps: [
          { action: 'update', name, content: first, evidence: [{ event_seq: 1 }] },
          { action: 'update', name, content: second, evidence: [{ event_seq: 1 }] },
        ],
      }
      ctx.provide('subagents', {
        start: async (_n: string, request: unknown) => {
          capturedRequest = request
          // The concurrent writer lands while the review subagent is "running"
          // — i.e. AFTER the pre-run baseline, BEFORE op 1 executes.
          if (betweenOps) await betweenOps(library)
          return {
            result: Promise.resolve({ structured: plan }),
            localAgent: null,
            dispose: async () => {},
          }
        },
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
      const session = ctx.sessions.create(SessionId(`${name}-session`))
      const agent = { id: session.id, session, ctx, inject: () => {} } as unknown as Agent
      ctx.agents.register(agent)
      session.append('turn/start', { turn: 1 })
      // Read-before-write: the parent session read the skill with its PAIRED
      // successful result (REV-06(a)) — the same shape TEST-01 uses, and what
      // makes BOTH update ops survive filterUnreadSkillOps.
      session.append('tool/call', {
        turn: 1, step: 0, callId: CallId(`read-${name}`),
        name: 'skill', arguments: JSON.stringify({ name }),
      })
      session.append('tool/result', {
        turn: 1, step: 0,
        message: createToolResultMessage({ callId: CallId(`read-${name}`), content: [{ type: 'text', text: 'skill loaded' }], isError: false }),
      }, { surfaceOp: 'append' })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `Please improve the ${name}. `.repeat(12) }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      await expect.poll(() => capturedRequest !== undefined, { timeout: 10000, interval: 50 }).toBe(true)
      // Wait for the plan to settle: op 2 either landed (the accept direction)
      // or was refused (the clobber direction) — both end with the file no
      // longer equal to op 1's intermediate bytes. Read the final bytes INSIDE
      // the fixture: the temp DSH_HOME is removed in the finally below.
      await expect.poll(
        async () => {
          const current = await library.read(name).catch(() => null)
          return current !== null && current !== first
        },
        { timeout: 3000, interval: 50 },
      ).toBe(true)
      return { first, second, landed: await library.read(name).catch(() => null) }
    } finally {
      await reviewFiber?.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }

  it('TEST-06 (REV-06b): the second of two updates on ONE skill lands (no false stale refusal)', { timeout: 30_000 }, async () => {
    const name = 'twice-skill'
    const { second, landed } = await runTwoOpPlan(name, 'dsh-review-rev06b-ok-', undefined)
    // Op 1 rebased the baseline onto its own bytes; op 2 is then compared
    // against that LANDED baseline, so it must NOT be refused as stale.
    expect(landed).toBe(second)
  })

  it('TEST-07 (REV-06b): a concurrent writer landing between the two ops is never overwritten', { timeout: 30_000 }, async () => {
    const name = 'concurrent-skill'
    const writerBytes = SKILL(name).replace('Body of', 'Concurrent writer body of')
    const { landed } = await runTwoOpPlan(name, 'dsh-review-rev06b-race-', async (library) => {
      await library.update(name, writerBytes, 'foreground')
    })
    // The writer's bytes must survive: the refresh only happens after a write
    // THIS plan landed, and op 1 is refused as stale against the concurrent
    // write, so nothing re-bases op 2 onto the writer's content.
    expect(landed).toBe(writerBytes)
  })
})
