// @tier ci-only
import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type Agent } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import EvolutionIoRegistry from '../../evolution-io/src/index.ts'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import * as discoveryPlugin from '../src/plugin.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function home(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-request-')); dirs.push(dir); return dir }
async function skill(root: string, name: string): Promise<void> { const dir = join(root, name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + name + ' description.\n---\n\nbody\n') }
class Adapter extends LlmAdapter {
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
  return new Promise(resolve => { const dispose = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { dispose(); resolve() } }) })
}

it('runs the production plugin through a real AgentLoop request', async () => {
  const dir = await home(); const root = join(dir, '.dsh/skills'); await skill(root, 'kept')
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(EvolutionIoRegistry)
  const files = new Map<string, string>()
  ctx.evolutionIo.registerProvider({ name: 'fake', readText: async path => files.get(path) ?? null, writeText: async (path, content) => { files.set(path, content) }, remove: async path => { files.delete(path) }, list: async () => [...files.keys()], exists: async path => files.has(path), rename: async (from, to) => { const value = files.get(from); if (value !== undefined) { files.set(to, value); files.delete(from) } }, copy: async (from, to) => { const value = files.get(from); if (value !== undefined) files.set(to, value) } })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: join(dir, '.dsh'), agentsHome: join(dir, '.agents'), watch: false })
  await ctx.plugin(toolSkill)
  await ctx.plugin(discoveryPlugin, { domainMapPath: join(dir, 'domain-map.json'), sessionPath: join(dir, 'sessions.json'), featureEpoch: 'epoch-1', mode: 'on' })
  const harness = await mountAgentLoopTestHarness(ctx)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await harness.create(SessionId('plugin-request'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  expect(adapter.requests).toHaveLength(1)
  expect(adapter.requests[0]!.messages.some(message => message.source.kind === 'evolution-skill-projection')).toBe(true)
})
