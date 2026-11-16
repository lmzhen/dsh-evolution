/**
 * The session-query half of the family's host platform boundary.
 *
 * The doctor only asks for the corpus listing and bounds the call itself; the
 * port keeps the platform receiver binding and the raw result shape out of the
 * feature.
 */
import type { Context } from '@deepseek-ai/cordis'

export interface SessionQueryPort {
  listSessions(signal?: AbortSignal): Promise<unknown>
}

interface SessionQueryServiceLike {
  listSessions?(signal?: AbortSignal): Promise<unknown>
}

/** Resolve the session-query port; undefined means the host has no such service. */
export function sessionQueryPort(ctx: Context): SessionQueryPort | undefined {
  // platform-declaration anchor: sessionQuery is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('sessionQuery') as SessionQueryServiceLike | undefined
  if (service === undefined || typeof service.listSessions !== 'function') return undefined
  return { listSessions: (signal) => service.listSessions!(signal) }
}
