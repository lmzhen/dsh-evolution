/**
 * The loopback HTTP plumbing every family route surface shares (E-302-era conventions).
 *
 * WHY THIS IS IN CORE: the fence, the bounded body reader and the JSON writer are the same for every
 * family route surface, and `evolution-core` is the one package all of them already depend on. The
 * canonical platform implementation (packages/client/connection/src/api-request-trust.ts) is not part
 * of that package's published surface, so the family keeps its own copy of the RULES here — once.
 *
 * Layering: pure transport. Nothing here knows about skills, approvals, curators or route tables.
 * @module @deepseek-ai/dsh-evolution-core/http-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isRecord } from './guards.ts'
import type { Context } from '@deepseek-ai/cordis'

/** Largest request body a family route accepts; a bigger one reads as "no body" (400 from the handler). */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024

/** The request facts the trust fence reads: a Node request, or the same fields in a spec fixture. */
export interface FenceRequest {
  readonly headers: Record<string, string | string[] | undefined>
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined
}

/** One header as a single string (a repeated header reads as absent rather than as its first value). */
function header(request: FenceRequest, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7))
  return isIPv4Loopback(normalized)
}

/** Whether a hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

/**
 * Whether one request may enter a family route.
 *
 * Rules, in order: the SOCKET must be loopback (authoritative — X-Forwarded-For is never trusted), the
 * Host header must name a loopback authority (DNS-rebinding defense), an explicit cross-site marker is
 * refused, and an attached Origin must be exactly this authority.
 * @param request - the request to judge.
 * @returns true when the request may proceed.
 */
export function isLoopbackRequest(request: FenceRequest): boolean {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  const host = header(request, 'host')
  if (host === undefined) return false
  let hostUrl: URL
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (header(request, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Write one JSON response. The routes own their response lifecycle, so every path ends here. */
export function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/**
 * Read one JSON request body, bounded.
 * @param req - the request.
 * @returns the parsed value, or null when the body is oversized, empty, or not JSON.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req as IncomingMessage) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_REQUEST_BODY_BYTES) return null
    chunks.push(buffer)
  }
  if (size === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Read one JSON request body that must be an OBJECT.
 *
 * Accepts the legacy Node request (existing family routes) and the platform ConnectionFetchRoute
 * Request (G4 migration), so both surfaces share one bounded reader.
 * @param req - the request.
 * @param maxBytes - the body bound (defaults to MAX_REQUEST_BODY_BYTES).
 * @returns the body as a plain object, or null when it is absent, oversized, not JSON, or not an object.
 */
export async function readJsonObject(
  req: IncomingMessage | Request,
  maxBytes: number = MAX_REQUEST_BODY_BYTES,
): Promise<Record<string, unknown> | null> {
  const body = await readJsonPayload(req, maxBytes)
  return isRecord(body) ? body : null
}

async function readJsonPayload(req: IncomingMessage | Request, maxBytes: number): Promise<unknown> {
  if (typeof Request !== 'undefined' && req instanceof Request) {
    const buffer = await req.arrayBuffer()
    if (buffer.byteLength > maxBytes || buffer.byteLength === 0) return null
    try {
      return JSON.parse(Buffer.from(buffer).toString('utf8'))
    } catch {
      return null
    }
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req as IncomingMessage) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) return null
    chunks.push(buffer)
  }
  if (size === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
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
  if (typeof injecting.inject !== 'function') throw new Error('E-325: host routes require a context that owns inject()')
  injecting.inject(['connection'], (scope: Context) => {
    const connection = (scope as unknown as { connection?: ConnectionServiceLike }).connection
    if (connection === undefined || connection.fetch === undefined || typeof connection.fetch.register !== 'function') {
      throw new Error('E-325: connection service is mounted without fetch.register()')
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
        throw new Error('E-325: host route path must carry the /api/dsh-evolution/ prefix: ' + route.path)
      }
    }
    const effect = (scope as unknown as { effect?: InjectingContext['effect'] }).effect
    if (typeof effect !== 'function') throw new Error('E-325: connection scope has no effect() to own the registration')
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
