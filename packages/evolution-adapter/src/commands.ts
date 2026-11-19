/**
 * The commands half of the family's host platform boundary.
 *
 * Feature packages register command definitions through this port; the platform
 * command runtime remains the owner of dispatch, client behavior and disposal.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'

export interface CommandsPort {
  register(definition: CommandDefinition): () => void
}

interface CommandsServiceLike {
  register(definition: CommandDefinition): () => void
}

/** Resolve the commands port; undefined means the host has no commands service. */
export function commandsPort(ctx: Context): CommandsPort | undefined {
  // platform-declaration anchor: commands is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('commands') as CommandsServiceLike | undefined
  if (service === undefined || typeof service.register !== 'function') return undefined
  return { register: (definition) => service.register(definition) }
}
