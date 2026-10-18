// The ONE extra preset row a restricted preset appends: restricts the child scope's tool set.
// Function plugin (no default export): static inject waits for the tools service, and the
// restriction is owned by ctx.effect so a fiber dispose releases it.
import type { Context } from '@deepseek-ai/cordis'

export const name = 'evolution-restrictor'
export const inject = ['tools'] as const

export interface Config {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

interface ToolRestrictionLike {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

interface ToolsServiceLike {
  restrict(filter: ToolRestrictionLike): () => void
}

function normalize(names: readonly string[] | undefined): readonly string[] {
  return [...new Set((names ?? []).map((name) => name.trim()).filter((name) => name !== ''))].sort()
}

export function apply(ctx: Context, config: Config): void {
  const allow = normalize(config.allow)
  const deny = normalize(config.deny)
  if (allow.length === 0 && deny.length === 0) {
    throw new Error('E-324: evolution restrictor needs a non-empty allow or deny set')
  }
  const tools = (ctx as unknown as { tools?: ToolsServiceLike }).tools
  if (tools === undefined || typeof tools.restrict !== 'function') {
    throw new Error('E-324: evolution restrictor requires the tools service (inject: tools)')
  }
  const effect = (ctx as unknown as { effect?: (run: () => () => void, label?: string) => unknown }).effect
  if (effect === undefined) {
    throw new Error('E-324: evolution restrictor requires a context that owns effect()')
  }
  const filter: ToolRestrictionLike = {
    ...(allow.length > 0 ? { allow } : {}),
    ...(deny.length > 0 ? { deny } : {}),
  }
  effect.call(ctx, () => tools.restrict(filter), 'evolution-restrictor')
}
