/**
 * The working-directory half of the family's host platform boundary.
 *
 * The platform resolves the session's cwd; the family only asks, keeping the
 * scope/cwd policy in one host seam.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

export interface WorkingDirectoryPort {
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>
}

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
