// @tier fast
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillUsageRegistry from '@deepseek-ai/dsh-evolution-skill-discovery/usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-core/io-registry'
import * as NodeIo from '@deepseek-ai/dsh-evolution-core/io-node'
import * as ToolSkillManage from '../../tool-skill-manage/src/index.ts'
import { clearReviewChannel, withReviewContext } from '@deepseek-ai/dsh-evolution-core'
import { runReview } from '../src/review-executor.ts'
import type { ReviewLlmPort, ReviewParent, ReviewToolPort } from '../src/review-executor.ts'
import { executeTool } from './support/execute-tool.ts'

const parentId = SessionId('aux-skill-parent')
let root = ''
let previousHome: string | undefined

afterEach(async () => {
  clearReviewChannel(parentId)
  if (root !== '') await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

const call = { type: 'tool-call' as const, id: ToolCallId('aux-skill-create'), name: 'skill_manage', arguments: JSON.stringify({ action: 'create', name: 'aux-skill', content: '---\nname: aux-skill\ndescription: aux skill probe.\n---\nBody.\n' }) }
const toolChunks: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: call },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
const textChunks: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

function parent(): ReviewParent {
  const header = { config: { provider: 'mock', model: 'mock' }, tools: [{ name: 'skill_manage', description: '', parameters: {} }] } as EpochHeader
  return {
    id: parentId,
    status: 'idle',
    session: {
      id: parentId,
      seq: 9,
      requestHeader: () => header,
      deriveMessages: () => [createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } })] as Message[],
      toolHistory: () => undefined,
    },
  }
}

describe('real skill_manage write', () => {
  it('creates a managed skill through the review executor', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-aux-skill-'))
    previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      await ctx.plugin(SkillUsageRegistry, { root })
      await ctx.plugin(ToolSkillManage)
      const p = parent()
      const toolAgent = { session: { id: parentId, header: {} } } as unknown as Agent
      const script = [toolChunks, textChunks]
      const llm: ReviewLlmPort = {
        stream() {
          const next = script.shift()
          if (next === undefined) throw new Error('unexpected request')
          return (async function* () { for (const chunk of next) yield chunk })()
        },
      }
      const tools: ReviewToolPort = {
        async execute(input) {
          const results = []
          for (const toolCall of input.calls) {
            const result = await executeTool(ctx, toolAgent, toolCall.id, toolCall.name, toolCall.arguments, input.signal)
            results.push({ callId: toolCall.id, result })
          }
          return { results }
        },
      }
      const result = await withReviewContext({ reviewId: 'ctx-review', runId: 'ctx-run' }, () => runReview({
        parent: p,
        llm,
        tools,
        instruction: 'review',
        toolAllow: new Set(['skill_manage']),
        signal: new AbortController().signal,
        markReview: () => {},
        clearReview: () => {},
      }))
      expect(result.actions).toEqual([{ type: 'skill', action: 'skill_manage', target: 'aux-skill', status: 'ok' }])
      const dir = join(root, 'skills', 'aux-skill')
      expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toContain('Body.')
      expect(await readFile(join(dir, '.hermes-managed'), 'utf8').then(() => true)).toBe(true)
      expect((await ctx.skillUsage.report()).get('aux-skill')?.created_by).toBe('agent')
      const pinResult = await executeTool(ctx, toolAgent, ToolCallId('pin'), 'skill_manage', JSON.stringify({ action: 'pin', name: 'aux-skill' }), new AbortController().signal)
      expect((pinResult as { value?: { ok?: boolean } }).value?.ok).toBe(true)
      const update = await withReviewContext({ reviewId: 'ctx-review', runId: 'ctx-run' }, () => executeTool(ctx, toolAgent, ToolCallId('update'), 'skill_manage', JSON.stringify({ action: 'update', name: 'aux-skill', content: '---\nname: aux-skill\ndescription: changed.\n---\nChanged.\n' }), new AbortController().signal))
      expect((update as { value?: { ok?: boolean; message?: string } }).value?.ok).toBe(false)
      expect((update as { value?: { message?: string } }).value?.message).toContain('受保护（pinned）')
      expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toContain('Body.')
      expect(p.session.seq).toBe(9)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
