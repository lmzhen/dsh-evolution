// @tier ci-only
import { afterEach, expect, it } from 'vitest'
import { provideWorkingDirectoryFixture, unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION, type Agent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { installCatalogProjection, projectCatalog, skillIndexRowOf, skillKeyOf, type DomainCard, type ProjectionDigestStore } from '../src/index.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function home(): Promise<string> { const dir = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'dsh-projection-'))); dirs.push(dir); return dir }
async function skill(root: string, name: string): Promise<void> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + name + ' description.\n---\n\n# ' + name + '\n\n' + name + ' body.\n')
}
function agentFor(cwd: string): Agent {
  const id = SessionId('projection-agent')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false })
  return { ctx: new Context(), id, options: {}, session, inbox: unsupportedInbox(), status: 'idle', send: () => {}, followup: () => {}, steer: () => {}, inject: () => { throw new Error('no') }, cancel() {}, runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve() }
}
function summary(name: string, provider = 'dsh-evolution'): SkillSummary {
  return { name, description: name + ' description.', whenToUse: 'when ' + name, invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider }
}
const card: DomainCard = { id: 'd', title: 'Domain', purpose: 'p', triggers: [], descriptionStatus: 'fresh', managedModelInvocableCount: 1, externalCatalogCount: 1, managedCount: 1, externalCount: 1, pendingCount: 0, state: 'active', asOf: 'now', mapVersion: 'm', mapStale: false }
async function setup(dir: string, provider: (entries: readonly { name: string; description: string }[]) => ReturnType<typeof projectCatalog>, gate?: () => boolean, install = true, digestStore?: ProjectionDigestStore): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx, dir)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: join(dir, '.dsh'), agentsHome: join(dir, '.agents'), watch: false })
  await ctx.plugin(toolSkill)
  if (install) await ctx.plugin(Object.assign((inner: Context) => { installCatalogProjection(inner, { ...(gate === undefined ? {} : { shouldProject: gate }), project: ({ catalogEntries }) => provider(catalogEntries) }, digestStore) }, { inject: ['agents'] }))
  return { ctx, agent: agentFor(dir) }
}

it('installs the adapter in a real pre-step waterfall and keeps hidden loadable', async () => {
  const dir = await home()
  const root = join(dir, '.dsh/skills')
  await skill(root, 'hidden')
  await skill(root, 'kept')
  const hidden = summary('hidden')
  const kept = summary('kept', 'other')
  const { ctx, agent } = await setup(dir, entries => projectCatalog({
    entries,
    rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)],
    activeManagedSkillKeys: new Set([skillKeyOf(hidden)]),
    cards: [card],
    viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c',
    adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true,
  }))
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') return
  const messages = decision.messages as UserMessage[]
  expect(messages.some(message => message.source.kind === 'evolution-skill-projection')).toBe(true)
  for (const message of messages) agent.session.append('user/message', message, { surfaceOp: 'append' })
  const second = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 2, signal }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  expect(second.kind).toBe('enter')
  if (second.kind !== 'enter') return
  expect((second.messages as UserMessage[]).some(message => message.source.kind === 'evolution-skill-projection')).toBe(false)
  expect(JSON.stringify(messages)).not.toContain('hidden description.')
  expect(JSON.stringify(messages)).toContain('kept description.')
  const loaded = await ctx.tools.execute({ signal, callId: ToolCallId('hidden-load'), name: 'skill', arguments: { name: 'hidden' }, agent })
  expect(loaded.isError).toBe(false)
  expect(JSON.stringify(loaded.content)).toContain('hidden body.')
})


it('keeps the full catalog when the session gate says no', async () => {
  const dir = await home(); const root = join(dir, '.dsh/skills'); await skill(root, 'hidden'); await skill(root, 'kept')
  const hidden = summary('hidden'); const kept = summary('kept', 'other')
  const baseline = await setup(dir, entries => projectCatalog({ entries, rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)], activeManagedSkillKeys: new Set([skillKeyOf(hidden)]), cards: [card], viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true }), undefined, false)
  const baselineSignal = new AbortController().signal
  const baselineDecision = await agentEvents(baseline.ctx, baseline.agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal: baselineSignal }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  const baselineMessages = baselineDecision.kind === 'enter' ? baselineDecision.messages as UserMessage[] : []
  const { ctx, agent } = await setup(dir, entries => projectCatalog({ entries, rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)], activeManagedSkillKeys: new Set([skillKeyOf(hidden)]), cards: [card], viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true }), () => false)
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') return
  const messages = decision.messages as UserMessage[]
  expect(messages.some(message => message.source.kind === 'evolution-skill-projection')).toBe(false)
  const normalize = (items: UserMessage[]): string => JSON.stringify(items.map(item => ({ ...item, id: 'normalized' })))
  expect(normalize(messages)).toBe(normalize(baselineMessages))
  expect(JSON.stringify(messages)).toContain('hidden description.')
})


it('re-emits when digest matches but the projection is absent from the surface', async () => {
  const dir = await home(); const root = join(dir, '.dsh/skills'); await skill(root, 'hidden'); await skill(root, 'kept')
  const hidden = summary('hidden'); const kept = summary('kept', 'other')
  const projection = projectCatalog({ entries: [{ name: 'hidden', description: 'hidden description.' }, { name: 'kept', description: 'kept description.' }], rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)], activeManagedSkillKeys: new Set([skillKeyOf(hidden)]), cards: [card], viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true })
  const digestStore: ProjectionDigestStore = { get: async () => projection.digest, set: async () => {} }
  const { ctx, agent } = await setup(dir, entries => projectCatalog({ entries, rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)], activeManagedSkillKeys: new Set([skillKeyOf(hidden)]), cards: [card], viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true }), undefined, true, digestStore)
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') return
  const messages = decision.messages as UserMessage[]
  expect(messages.some(message => message.source.kind === 'evolution-skill-projection')).toBe(true)
  expect(messages.some(message => message.source.kind === 'skill-catalog')).toBe(false)
})


it('skips catalog removal when the same projection is still present on the surface', async () => {
  const dir = await home(); const root = join(dir, '.dsh/skills'); await skill(root, 'hidden'); await skill(root, 'kept')
  const hidden = summary('hidden'); const kept = summary('kept', 'other')
  const projection = projectCatalog({ entries: [{ name: 'hidden', description: 'hidden description.' }, { name: 'kept', description: 'kept description.' }], rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)], activeManagedSkillKeys: new Set([skillKeyOf(hidden)]), cards: [card], viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true })
  const digestStore: ProjectionDigestStore = { get: async () => projection.digest, set: async () => {} }
  const { ctx, agent } = await setup(dir, entries => projectCatalog({ entries, rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)], activeManagedSkillKeys: new Set([skillKeyOf(hidden)]), cards: [card], viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true }), undefined, true, digestStore)
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'existing projection' }], source: { kind: 'evolution-skill-projection', entries: [], hiddenNames: [], digest: projection.digest } }), { surfaceOp: 'append' })
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') return
  const messages = decision.messages as UserMessage[]
  expect(messages.some(message => message.source.kind === 'evolution-skill-projection')).toBe(false)
  expect(messages.some(message => message.source.kind === 'skill-catalog')).toBe(false)
})


it('re-emits after a surface replace shadows the projection in the raw log', async () => {
  const dir = await home(); const root = join(dir, '.dsh/skills'); await skill(root, 'hidden'); await skill(root, 'kept')
  const hidden = summary('hidden'); const kept = summary('kept', 'other')
  const projection = projectCatalog({ entries: [{ name: 'hidden', description: 'hidden description.' }, { name: 'kept', description: 'kept description.' }], rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)], activeManagedSkillKeys: new Set([skillKeyOf(hidden)]), cards: [card], viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true })
  const digestStore: ProjectionDigestStore = { get: async () => projection.digest, set: async () => {} }
  const { ctx, agent } = await setup(dir, entries => projectCatalog({ entries, rows: [skillIndexRowOf(hidden, true), skillIndexRowOf(kept, false)], activeManagedSkillKeys: new Set([skillKeyOf(hidden)]), cards: [card], viewKey: 'v', scope: 's', mapVersion: 'm', policyDigest: 'p', viewCatalogDigest: 'c', adapterVersion: 'a', projectionSchemaVersion: 'ps', discoveryMode: 'on', complete: true }), undefined, true, digestStore)
  const projectionMessage = createUserMessage({ content: [{ type: 'text', text: 'projection' }], source: { kind: 'evolution-skill-projection', entries: [], hiddenNames: [], digest: projection.digest } })
  const projectionSeq = agent.session.append('user/message', projectionMessage, { surfaceOp: 'append' })
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'replacement' }], source: { kind: 'user' } }), { surfaceOp: { op: 'replace', startSeq: agent.session.seq - 1, endSeq: agent.session.seq - 1 }, sourceEventSeqs: [agent.session.seq - 1] })
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') return
  const messages = decision.messages as UserMessage[]
  expect(messages.some(message => message.source.kind === 'evolution-skill-projection')).toBe(true)
  expect(messages.some(message => message.source.kind === 'skill-catalog')).toBe(false)
})
