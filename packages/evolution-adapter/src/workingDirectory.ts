/**
 * The working-directory implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WorkingDirectoryPort } from './contract/index.ts'

export type { WorkingDirectoryPort } from './contract/index.ts'

interface WorkingDirectoryServiceLike {
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>
}

/** Resolve the working-directory port; undefined means the host has no such service. */
export function workingDirectoryPort(ctx: Context): WorkingDirectoryPort | undefined {
  // platform-declaration anchor: workingDirectory is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('workingDirectory') as WorkingDirectoryServiceLike | undefined
  if (service === undefined || typeof service.ensure !== 'function') return undefined
  return { ensure: (agent, signal) => service.ensure(agent, signal) }
}
