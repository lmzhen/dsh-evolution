// @tier ci-only
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type Agent } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import EvolutionIoRegistry from '../../evolution-io/src/index.ts'
import * as mainEntry from '../src/main-entry.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function home(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'dsh-main-entry-host-')); dirs.push(dir); return dir }

class ScriptAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return { provider, id: model, name: model } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise(resolve => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { dispose(); resolve() } })
  })
}

it('runs a real LLM request with main-entry mode:off and does not project', async () => {
  const dir = await home()
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider({ name: 'fake', readText: async () => null, writeText: async () => {}, remove: async () => {}, list: async () => [], exists: async () => false, rename: async () => {}, copy: async () => {} })
  await ctx.plugin(mainEntry, { featureEpoch: 'host', mode: 'off', searchEnabled: true })
  const harness = await mountAgentLoopTestHarness(ctx)
  const adapter = new ScriptAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await harness.create(SessionId('main-entry-request'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  expect(adapter.requests).toHaveLength(1)
  expect(adapter.requests[0]!.messages.some(message => message.source.kind === 'evolution-skill-projection')).toBe(false)
})