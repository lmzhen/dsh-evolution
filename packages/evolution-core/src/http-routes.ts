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
  for await (const chunk of req) {
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
 * The three route surfaces all take named fields, so "array or scalar" is a bad request rather than a
 * shape each handler has to re-check.
 * @param req - the request.
 * @returns the body as a plain object, or null when it is absent, oversized, not JSON, or not an object.
 */
export async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const body = await readJsonBody(req)
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
}
