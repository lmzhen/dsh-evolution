/**
 * W6/G4 test harness: a fake platform Host connection carrier for the family's exact Fetch routes.
 *
 * The platform's real carrier applies Host/Origin hygiene, browser auth and owner-peer admission
 * before it calls a route's `fetch(request)`, owns a by-path exact registry and hands out disposers.
 * Tests must not re-implement OR bypass that admission (the old loopback fence spec did the latter);
 * this harness models the carrier contract instead: duplicate-path refusal, method fall-through to
 * 404, owner/other principal split, disposer release, and a JSON convenience caller.
 *
 * Usage:
 *   const host = await mountHostRoutes(ctx, (audit) => makeXRoutes(face, audit))
 *   const res = await host.call(HOST_ROUTES.x.y, { method: 'GET' })
 *   expect(await res.json()).toMatchObject({ ok: true })
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRouteLike } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { registerHostRoutes } from '@deepseek-ai/dsh-evolution-core/http-routes'

export interface HostConnectionOptions {
  readonly allowsRemoteAuthorities?: boolean
  /** Which principal the harness's dispatch represents (default owner: exact routes are owner-only). */
  readonly principal?: 'owner' | 'other'
}

export interface HostCallInit {
  readonly method?: string
  /** An object is sent as JSON; a string is sent verbatim (for malformed/oversized body cases). */
  readonly body?: unknown
  readonly headers?: Record<string, string>
}

/** The fake carrier: register() collects routes; dispatch() reproduces the platform's selection. */
export class HostConnectionHarness {
  readonly routes: ConnectionFetchRouteLike[] = []
  readonly paths: string[] = []
  readonly released: string[] = []
  readonly allowsRemoteAuthorities: boolean
  private principal: 'owner' | 'other'

  constructor(options: HostConnectionOptions = {}) {
    this.allowsRemoteAuthorities = options.allowsRemoteAuthorities ?? false
    this.principal = options.principal ?? 'owner'
  }

  /** Install this harness as the ctx's `connection` service (call before or after the plugin applies). */
  install(ctx: Context): this {
    const service = {
      allowsRemoteAuthorities: this.allowsRemoteAuthorities,
      fetch: { register: (route: ConnectionFetchRouteLike) => this.register(route) },
    }
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('connection', service)
    return this
  }

  private register(route: ConnectionFetchRouteLike): () => Promise<void> {
    if (this.routes.some(candidate => candidate.path === route.path)) {
      throw new Error('duplicate exact route: ' + route.path)
    }
    this.routes.push(route)
    this.paths.push(route.path)
    let live = true
    return async () => {
      if (!live) return
      live = false
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
      this.released.push(route.path)
    }
  }

  /**
   * Reproduce the platform shared-handler selection: exact path + listed method + owner peer.
   * A method the route did not declare falls through (the platform's shared RPC then answers 404).
   */
  dispatch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    const route = this.routes.find(candidate => candidate.path === pathname)
    if (route === undefined || !route.methods.includes(request.method as never)) {
      return Promise.resolve(new Response('not found', { status: 404 }))
    }
    if (this.principal !== 'owner') return Promise.resolve(new Response('forbidden', { status: 403 }))
    return route.fetch(request)
  }

  /** One request through the carrier. The URL is always a loopback authority (the platform owns trust). */
  call(path: string, init: HostCallInit = {}): Promise<Response> {
    const method = init.method ?? 'GET'
    const headers: Record<string, string> = { host: '127.0.0.1:3080', ...init.headers }
    let body: BodyInit | undefined
    if (init.body !== undefined) {
      if (typeof init.body === 'string') body = init.body
      else {
        body = JSON.stringify(init.body)
        headers['content-type'] = 'application/json'
      }
    }
    return this.dispatch(new Request('http://127.0.0.1:3080' + path, { method, headers, ...body === undefined ? {} : { body } }))
  }

  /** The carrier request plus JSON decode, for the family's `{ok:...}` envelope assertions. */
  async json<T = unknown>(path: string, init: HostCallInit = {}): Promise<{ status: number; body: T }> {
    const response = await this.call(path, init)
    const text = await response.text()
    let body: unknown = null
    if (text !== '') {
      // Platform-fall-through answers are plain text ('not found' / 'forbidden'); only the family's
      // own envelope is JSON. Decode when possible and hand the raw text through otherwise.
      try { body = JSON.parse(text) } catch { body = text }
    }
    return { status: response.status, body: body as T }
  }

  /** Await every disposer the family registered (HMR/unload simulation). */
  async releaseAll(): Promise<void> {
    const pending = this.routes.slice()
    for (const route of pending) {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
      this.released.push(route.path)
    }
  }
}

/**
 * Provide a fake connection and register one host surface through the REAL `registerHostRoutes`.
 * @param ctx - the owner context (the plugin fiber or the test root).
 * @param build - the family's route factory, receiving the audit captured at registration.
 * @param options - carrier behaviour (remote authorities / principal).
 */
export async function mountHostRoutes(
  ctx: Context,
  build: (audit: import('@deepseek-ai/dsh-evolution-core/http-routes').DecisionAudit) => readonly ConnectionFetchRouteLike[],
  options: HostConnectionOptions = {},
): Promise<HostConnectionHarness> {
  const harness = new HostConnectionHarness(options)
  harness.install(ctx)
  registerHostRoutes(ctx, build)
  await new Promise(resolve => setTimeout(resolve, 0))
  return harness
}

/** Provide the fake connection without registering anything (mounting-order specs). */
export function provideHostConnection(ctx: Context, options: HostConnectionOptions = {}): HostConnectionHarness {
  return new HostConnectionHarness(options).install(ctx)
}
