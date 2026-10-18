/**
 * The Host data-plane contract + Fetch-shaped helpers every family route surface shares (W1/W6).
 *
 * WHY THIS IS IN CORE: HOST_ROUTES is the ONE path table (clients are generated from it), and the
 * response/body helpers are thin platform-Request utilities. The loopback fence that used to live here
 * is GONE (G4): trust, browser auth and owner admission are applied by the platform's connection
 * carrier BEFORE a route's fetch(request) runs, so a family copy of those rules was a second admission
 * path (and did diverge).
 *
 * Layering: pure transport. Nothing here knows about skills, approvals, curators or route tables.
 * @module @deepseek-ai/dsh-evolution-core/http-routes
 */

import { isRecord } from './guards.ts'
import type { Context } from '@deepseek-ai/cordis'

/** Largest request body a family route accepts; a bigger one reads as "no body" (400 from the handler). */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024

/**
 * Read one JSON request body that must be an OBJECT, bounded.
 * @param request - the platform Fetch Request handed to a route.
 * @param maxBytes - the body bound (defaults to MAX_REQUEST_BODY_BYTES).
 * @returns the body as a plain object, or null when it is absent, oversized, not JSON, or not an object.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number = MAX_REQUEST_BODY_BYTES,
): Promise<Record<string, unknown> | null> {
  const buffer = await request.arrayBuffer()
  if (buffer.byteLength > maxBytes || buffer.byteLength === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(buffer).toString('utf8'))
  } catch {
    return null
  }
  return isRecord(parsed) ? parsed : null
}

// ---------------------------------------------------------------------------------------------------
// Host data-plane contract (G0 freeze; G4 implements registration and the three-package migration).
// ---------------------------------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'HEAD' | 'POST'

export type HostRoutePath = `/api/dsh-evolution/${string}`

export interface HostRouteSpec {
  readonly path: HostRoutePath
  readonly methods: readonly HttpMethod[]
  readonly requestBody: 'buffered' | 'streaming'
}

export interface ConnectionFetchRouteLike extends HostRouteSpec {
  fetch(request: Request): Promise<Response>
}

export interface DecisionAudit {
  readonly channel: 'connection.fetch' | 'command'
  readonly principal: 'owner'
  readonly deploymentAllowsRemote: boolean
}

export const HOST_ROUTES = {
  approval: {
    pending: '/api/dsh-evolution/approval/pending',
    preview: '/api/dsh-evolution/approval/preview',
    approve: '/api/dsh-evolution/approval/approve',
    reject: '/api/dsh-evolution/approval/reject',
  },
  skillHistory: {
    skills: '/api/dsh-evolution/skill-history/skills',
    versions: '/api/dsh-evolution/skill-history/versions',
    diff: '/api/dsh-evolution/skill-history/versions/diff',
    body: '/api/dsh-evolution/skill-history/versions/body',
    undo: '/api/dsh-evolution/skill-history/undo',
    health: '/api/dsh-evolution/skill-history/health',
  },
  skillHealth: {
    rows: '/api/dsh-evolution/skill-health/rows',
  },
  diagnostics: {
    view: '/api/dsh-evolution/diagnostics',
  },
} as const

export type HostSurface =
  | { readonly available: true; readonly allowsRemoteAuthorities: boolean }
  | { readonly available: false; readonly code: 'E-325'; readonly reason: 'connection-missing' | 'service-absent' }

export function hostSurface(ctx: Context): HostSurface {
  const connection = (ctx as unknown as { get(name: string): unknown }).get('connection')
  if (connection === undefined) return { available: false, code: 'E-325', reason: 'connection-missing' }
  const allows = (connection as { readonly allowsRemoteAuthorities?: boolean }).allowsRemoteAuthorities === true
  return { available: true, allowsRemoteAuthorities: allows }
}

interface ConnectionFetchLike {
  register(route: ConnectionFetchRouteLike): () => Promise<void>
}

interface ConnectionServiceLike {
  readonly allowsRemoteAuthorities?: boolean
  readonly fetch?: ConnectionFetchLike
}

interface InjectingContext {
  inject(names: readonly string[], run: (scope: Context) => void): void
  effect(run: () => () => void, label?: string): unknown
}

/**
 * Register the family host surface on the platform's exact-route carrier.
 *
 * The platform owns admission (Host/Origin hygiene + browserAuth + exact-route owner peer) and the
 * disposer is bound to the CALLING fiber, not the connection service: the connection service can
 * outlive a reloaded family fiber, so the family must release its own registrations on dispose.
 * Routes carry the audit snapshot taken at registration time (deployment-level facts only — the
 * exact-route handler receives a Request, not the peer identity).
 */
export function registerHostRoutes(
  owner: Context,
  build: (audit: DecisionAudit) => readonly ConnectionFetchRouteLike[],
): void {
  const injecting = owner as unknown as Partial<InjectingContext>
  if (typeof injecting.inject !== 'function') throw new Error('host routes require a context that owns inject()')
  injecting.inject(['connection'], (scope: Context) => {
    const connection = (scope as unknown as { connection?: ConnectionServiceLike }).connection
    if (connection === undefined || connection.fetch === undefined || typeof connection.fetch.register !== 'function') {
      throw new Error('connection service is mounted without fetch.register()')
    }
    const register = connection.fetch.register.bind(connection.fetch)
    const audit: DecisionAudit = {
      channel: 'connection.fetch',
      principal: 'owner',
      deploymentAllowsRemote: connection.allowsRemoteAuthorities === true,
    }
    const routes = build(audit)
    for (const route of routes) {
      if (!route.path.startsWith('/api/dsh-evolution/')) {
        throw new Error('host route path must carry the /api/dsh-evolution/ prefix: ' + route.path)
      }
    }
    const effect = (scope as unknown as { effect?: InjectingContext['effect'] }).effect
    if (typeof effect !== 'function') throw new Error('connection scope has no effect() to own the registration')
    effect.call(scope, () => {
      const disposers: Array<() => Promise<void>> = []
      try {
        for (const route of routes) disposers.push(register(route))
      } catch (error) {
        for (const dispose of disposers) { try { void dispose() } catch { /* best-effort rollback */ } }
        throw error
      }
      return () => {
        for (const dispose of disposers) {
          try { void dispose() } catch { /* a failed disposer must not mask the others */ }
        }
      }
    }, 'evolution-host-routes')
  })
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function methodNotAllowed(allowed: readonly HttpMethod[]): Response {
  return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: allowed.join(', ') },
  })
}
