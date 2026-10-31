import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type Agent } from '@deepseek-ai/dsh-session'
import AgentLoop from '../../../core/agent-loop/src/index.ts'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { buildDomainProjection, installCatalogProjection, skillIndexRowOf, skillKeyOf } from '../src/index.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function home(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'dsh-request-projection-')); dirs.push(dir); return dir }
async function skill(root: string, name: string): Promise<void> { const dir = join(root, name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + name + ' description.\n---\n\n' + name + ' body.\n') }

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
function summary(name: string): SkillSummary { return { name, description: name + ' description.', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'dsh-evolution' } }

it('projects in a real LLM request once and keeps one digest on the next turn', async () => {
  const dir = await home(); const root = join(dir, '.dsh/skills'); await skill(root, 'hidden'); await skill(root, 'kept')
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: join(dir, '.dsh'), agentsHome: join(dir, '.agents'), watch: false })
  await ctx.plugin(toolSkill)
  const hidden = summary('hidden'); const kept = summary('kept')
  await ctx.plugin(Object.assign((inner: Context) => {
    installCatalogProjection(inner, { project: ({ catalogEntries }) => buildDomainProjection({
      entries: catalogEntries,
      rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)],
      complete: true,
      snapshot: { mapVersion: '1', domains: [{ id: 'd', name: 'd', purpose: 'distinct purpose', description: 'd', inScope: ['a'], outOfScope: ['b'], triggers: ['t'], parentIds: [], status: 'active', version: 1, createdAt: 0, updatedAt: 0, descriptionHash: 'h', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: {}, quality: {} }], edges: [{ skillKey: skillKeyOf(hidden), domainId: 'd', role: 'primary', confidence: 1, source: 'manual', skillHash: 'h', mapVersion: '1', status: 'active', assignedAt: 0 }] },
      policy: { mode: 'on', pinned: new Set(), disabled: new Set(), degraded: [] },
      viewKey: 'v', scope: 's', mapVersion: '1', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on',
    }) })
  }, { inject: ['agents'] }))
  const harness = await mountAgentLoopTestHarness(ctx)
  const adapter = new ScriptAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await harness.create(SessionId('projection-request'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  expect(adapter.requests).toHaveLength(1)
  const countProjection = (request: GenerateOptions): number => request.messages.filter(message => message.source.kind === 'evolution-skill-projection').length
  expect(countProjection(adapter.requests[0]!)).toBe(1)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  expect(adapter.requests).toHaveLength(2)
  expect(countProjection(adapter.requests[1]!)).toBe(1)
})
