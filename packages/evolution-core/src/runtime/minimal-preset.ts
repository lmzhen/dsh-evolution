/**
 * Keep the family's model-facing surface out of the platform's minimal preset.
 *
 * The platform minimal preset deliberately has no skill loader or skill
 * catalog. `evolution-all` mounts its model rows at profile root, which would
 * otherwise leak memory/skill management into that preset. The public runtime
 * API can hide those tools per agent scope without unloading the family's
 * infrastructure; UI panels and commands remain profile-level.
 *
 * @module @deepseek-ai/dsh-evolution-core/runtime/minimal-preset
 */
import type { Context } from '@deepseek-ai/cordis'

/** Family tools that must never be model-visible in the minimal preset. */
export const MINIMAL_PRESET_DENY_TOOLS = [
  'memory',
  'skill_manage',
  'skill_search',
  'skill',
  'maintenance_probe',
  'merge_stage',
] as const

interface ScopedTools {
  get?(name: string, scope?: unknown): unknown
  restrict?(filter: { deny: readonly string[] }): () => void
}

interface RuntimeAgent {
  readonly id: unknown
  readonly session?: { readonly id?: unknown }
  readonly ctx?: unknown
}

interface ProjectionRegistry {
  snapshot?(target: unknown, keys?: readonly string[]): { values?: Record<string, unknown> } | undefined
}

function activePreset(ctx: Context, agent: RuntimeAgent): string | undefined {
  const registry = ctx.get('sessionProjections') as ProjectionRegistry | undefined
  const projected = registry?.snapshot?.(agent.session, ['agentPreset'])?.values?.agentPreset
  if (typeof projected === 'string') return projected
  const headerPreset = (agent.session as { header?: { agentPreset?: unknown } } | undefined)?.header?.agentPreset
  return typeof headerPreset === 'string' ? headerPreset : undefined
}

/** Install the per-agent minimal-preset guard. */
export function installMinimalPresetGuard(ctx: Context): void {
  const disposers = new Map<unknown, () => void>()

  const sync = (agent: RuntimeAgent): void => {
    const key = agent.id
    if (activePreset(ctx, agent) !== 'minimal') {
      disposers.get(key)?.()
      disposers.delete(key)
      return
    }
    if (disposers.has(key)) return
    const tools = (agent.ctx as { tools?: ScopedTools } | undefined)?.tools
    if (tools?.restrict === undefined) return
    const known = MINIMAL_PRESET_DENY_TOOLS.filter(name => {
      try { return tools.get?.(name, agent) !== undefined } catch { return false }
    })
    if (known.length === 0) return
    disposers.set(key, tools.restrict({ deny: known }))
  }

  ctx.inject(['agents'], child => {
    const events = child as unknown as {
      on(event: string, listener: (...args: unknown[]) => void): () => void
      agents?: { get(id: unknown): RuntimeAgent | undefined }
    }
    const created = events.on('agent/created', payload => {
      const agent = (payload as { agent?: RuntimeAgent } | undefined)?.agent
      if (agent !== undefined) sync(agent)
    })
    const selected = events.on('agent-preset/selected', (sessionId) => {
      const agent = events.agents?.get(sessionId)
      if (agent !== undefined) sync(agent)
    })
    const disposed = events.on('agent/disposed', payload => {
      const agent = (payload as { agent?: RuntimeAgent } | undefined)?.agent
      if (agent === undefined) return
      disposers.get(agent.id)?.()
      disposers.delete(agent.id)
    })
    child.effect(() => () => {
      created()
      selected()
      disposed()
      for (const dispose of disposers.values()) dispose()
      disposers.clear()
    })
  })
}
