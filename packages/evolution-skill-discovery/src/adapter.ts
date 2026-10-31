import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type UserMessage } from '@deepseek-ai/dsh-session'
import type { CatalogEntry, ProjectionResult } from './projection.ts'
import { sanitizeUntrustedText } from './security.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'skill-catalog': {
      readonly kind: 'skill-catalog'
      readonly form: 'catalog'
      readonly entries: readonly CatalogEntry[]
    } & ContextFormed
    'evolution-skill-projection': {
      readonly kind: 'evolution-skill-projection'
      readonly entries: readonly CatalogEntry[]
      readonly hiddenNames: readonly string[]
      readonly digest: string
    } & ContextFormed
  }
}

/** Provider the plugin supplies from SkillIndex + DomainMap + policy. */
export interface ProjectionDigestStore {
  get(agentKey: string): Promise<string | undefined>
  set(agentKey: string, digest: string): Promise<void>
}

export interface CatalogProjectionProvider {
  /** Optional persisted-session gate; false keeps the full catalog. */
  shouldProject?(agent: Agent): boolean | Promise<boolean>
  project(input: { readonly agent: Agent; readonly catalogEntries: readonly CatalogEntry[] }): ProjectionResult | Promise<ProjectionResult>
}

/** @returns true for the platform catalog message. */
function isCatalogMessage(message: UserMessage): message is UserMessage & {
  source: { kind: 'skill-catalog'; form: 'catalog'; entries: readonly CatalogEntry[] }
} {
  return message.source.kind === 'skill-catalog'
}

function escapeData(value: string): string {
  return sanitizeUntrustedText(value, 2000).text
}

function renderCatalog(entries: readonly CatalogEntry[]): string[] {
  if (entries.length === 0) return []
  return [
    '<system-reminder>',
    'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
    '<available_skills>',
    ...entries.map(entry => '- ' + escapeData(entry.name) + ': ' + escapeData(entry.description)),
    '</available_skills>',
    'Call the skill tool with the exact name before acting.',
    '</system-reminder>',
  ]
}

/** Build the plugin-owned replacement message from a complete projection. */
function projectionPresent(agent: { session: { seq: number; surface: { nodes: readonly unknown[] }; eventAt: (seq: never) => { type: string; data?: unknown; seq: unknown } | undefined } }, digest: string): boolean {
  try {
    const visible = new Set(agent.session.surface.nodes)
    for (let index = agent.session.seq - 1; index >= 0; index -= 1) {
      const event = agent.session.eventAt(SessionSeq(index) as never)
      if (event === undefined) return false
      if (event.type !== 'user/message') continue
      const data = event.data as { source?: { kind?: string; digest?: string } } | undefined
      if (data?.source?.kind !== 'evolution-skill-projection' || data.source.digest !== digest) continue
      if (visible.has(event.seq)) return true
    }
  } catch { return false }
  return false
}

function renderProjection(result: ProjectionResult): UserMessage | undefined {
  const text = [...renderCatalog(result.catalogEntries), ...(result.context === '' ? [] : [result.context])].join('\n')
  if (text === '') return undefined
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'evolution-skill-projection',
      entries: result.catalogEntries,
      hiddenNames: result.hiddenNames,
      digest: result.digest,
    },
  })
}

/**
 * Atomically replace one platform catalog message with the plugin projection.
 * @param decision - the waterfall decision; only enter decisions are changed.
 * @param result - a complete projection; incomplete results are ignored.
 * @returns a new decision, or the original when no safe replacement exists.
 */
export function applyCatalogProjection(decision: PreStepDecision, result: ProjectionResult): PreStepDecision {
  if (decision.kind !== 'enter' || !result.complete) return decision
  const index = decision.messages.findIndex(isCatalogMessage)
  if (index < 0) return decision
  const replacement = renderProjection(result)
  const messages = [...decision.messages]
  if (replacement === undefined) messages.splice(index, 1)
  else messages[index] = replacement
  return { ...decision, messages }
}

/**
 * Install the thin pre-step adapter. The listener is outer; it always calls
 * next, only touches the platform catalog message, and fails open.
 * @param ctx - plugin context.
 * @param provider - projection provider backed by SkillIndex/DomainMap.
 * @returns disposer from ctx.on.
 */
export function installCatalogProjection(ctx: Context, provider: CatalogProjectionProvider, digestStore?: ProjectionDigestStore): () => void {
  const projectedDigest = new Map<string, string>()
  return ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const catalog = decision.messages.find(isCatalogMessage)
    if (catalog === undefined) return decision
    try {
      if (provider.shouldProject !== undefined && !(await provider.shouldProject(agent))) return decision
      const result = await provider.project({ agent, catalogEntries: catalog.source.entries })
      if (!result.complete) return decision
      const agentKey = String(agent.id)
      const previousDigest = projectedDigest.get(agentKey) ?? await digestStore?.get(agentKey)
      if (previousDigest === result.digest && projectionPresent(agent, result.digest)) {
        return { ...decision, messages: decision.messages.filter(message => !isCatalogMessage(message)) }
      }
      const nextDecision = applyCatalogProjection(decision, result)
      if (nextDecision !== decision) {
        projectedDigest.set(agentKey, result.digest)
        await digestStore?.set(agentKey, result.digest)
      }
      return nextDecision
    } catch {
      return decision
    }
  }, { prepend: true })
}
