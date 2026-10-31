import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SessionPersistenceJsonl from '../../../session/session-persistence-jsonl/src/index.ts'
import EvolutionIoRegistry from '../../evolution-io/src/index.ts'
import * as discoveryPlugin from '../src/plugin.ts'
import { DISCOVERY_AWARENESS } from '../src/index.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

it('keeps awareness on a resumed agent scope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-discovery-resume-')); dirs.push(dir)
  const files = new Map<string, string>()
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: false })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SessionPersistenceJsonl, { root: join(dir, 'persisted'), compression: 'zstd' })
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider({ name: 'fake', readText: async path => files.get(path) ?? null, writeText: async (path, content) => { files.set(path, content) }, remove: async () => {}, list: async () => [], exists: async path => files.has(path), rename: async () => {}, copy: async () => {} })
  await ctx.plugin(discoveryPlugin, { domainMapPath: join(dir, 'map.json'), sessionPath: join(dir, 'sessions.json'), featureEpoch: 'epoch-1', mode: 'on' })
  const harness = await mountAgentLoopTestHarness(ctx)
  const created = await ctx.agents.create({ sessionId: SessionId('resume-scope'), agentOptions: { provider: 'mock', model: 'mock' } })
  created.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'resume seed' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  await created.dispose()
  const resumed = await ctx.agents.resume({ resumeSessionId: SessionId('resume-scope') })
  const prompt = renderPrompt(await resumed.agent.ctx.systemPrompt.assemble())
  expect(prompt).toContain(DISCOVERY_AWARENESS)
})
