// The ONE extra preset row a restricted preset appends. It does NOT restrict the preset mount
// scope: that scope owns the preset's tool rows, and tools.restrict() only constrains INHERITED
// names (a scope's own layer is exempt). The row therefore observes child-agent creation and
// applies the restriction in the CHILD scope, where the preset rows are ancestors and the
// restriction is validated against the child's visible surface.
// Function plugin (no default export): inject waits for the registry that identifies which child
// belongs to this restricted preset; the restriction effect is owned by the child scope.
import type { Context } from '@deepseek-ai/cordis'

export const name = 'evolution-restrictor'
export const inject = ['agentPresets'] as const

export interface Config {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
  /** Restricted preset id this row belongs to; only agents composed with it are restricted. */
  readonly presetId?: string
}

interface ToolRestrictionLike {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

interface ToolsServiceLike {
  restrict(filter: ToolRestrictionLike): () => void
}

interface ScopedAgentLike {
  readonly ctx: Context
}

interface AgentCreatedPayload {
  readonly agent?: ScopedAgentLike
}

interface PresetRegistryLike {
  composedPreset(ctx: Context): string | undefined
}

function normalize(names: readonly string[] | undefined): readonly string[] {
  return [...new Set((names ?? []).map(value => value.trim()).filter(value => value !== ''))].sort()
}

function failure(detail: string): Error {
  return new Error('E-324: evolution restrictor ' + detail)
}

export function apply(ctx: Context, config: Config = {}): void {
  const allow = normalize(config.allow)
  const deny = normalize(config.deny)
  if (allow.length === 0 && deny.length === 0) throw failure('needs a non-empty allow or deny set')
  const filter: ToolRestrictionLike = {
    ...(allow.length > 0 ? { allow } : {}),
    ...(deny.length > 0 ? { deny } : {}),
  }
  const presetId = typeof config.presetId === 'string' && config.presetId.trim() !== '' ? config.presetId : undefined
  if (presetId === undefined) throw failure('requires the restricted presetId in its row config')
  const on = (ctx as unknown as { on?: (event: 'agent/created', listener: (payload: AgentCreatedPayload) => void) => unknown }).on
  if (typeof on !== 'function') throw failure('requires a context that owns on()')
  const presets = (ctx as unknown as { agentPresets?: PresetRegistryLike }).agentPresets
  if (presets === undefined || typeof presets.composedPreset !== 'function') {
    throw failure('requires the agentPresets service (inject: agentPresets)')
  }
  // The listener lives in the preset MOUNT scope: scope routing delivers every descendant
  // child's events here (a listener owned by an enclosing scope sees descendant events), and
  // `composedPreset` narrows it to the agents actually composed with this restricted preset.
  on.call(ctx, 'agent/created', (payload) => {
    const agent = payload.agent
    if (agent === undefined) return
    if (presets.composedPreset(agent.ctx) !== presetId) return
    const tools = (agent.ctx as unknown as { tools?: ToolsServiceLike }).tools
    if (tools === undefined || typeof tools.restrict !== 'function') {
      throw failure('child scope exposes no tools.restrict()')
    }
    const effect = (agent.ctx as unknown as { effect?: (run: () => () => void, label?: string) => unknown }).effect
    if (effect === undefined) throw failure('child scope owns no effect() to release the restriction')
    effect.call(agent.ctx, () => tools.restrict(filter), 'evolution-restrictor:child')
  })
}
