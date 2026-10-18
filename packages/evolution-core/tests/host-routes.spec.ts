import { describe, expect, it } from 'vitest'
import { HOST_ROUTES, hostSurface, registerHostRoutes, type DecisionAudit } from '../src/http-routes.ts'

function harness(options: { readonly noConnection?: boolean; readonly remote?: boolean } = {}) {
  const injected: Array<{ names: readonly string[]; run: (scope: unknown) => void }> = []
  const registered: Array<Record<string, unknown>> = []
  const disposed: number[] = []
  const effectRuns: Array<() => () => void> = []
  const connection = {
    allowsRemoteAuthorities: options.remote === true,
    fetch: {
      register(route: Record<string, unknown>) {
        registered.push(route)
        return async () => { disposed.push(1) }
      },
    },
  }
  const owner = {
    get: () => (options.noConnection === true ? undefined : connection),
    inject(names: readonly string[], run: (scope: unknown) => void) { injected.push({ names, run }) },
  }
  const scope = {
    connection: options.noConnection === true ? undefined : connection,
    effect(run: () => () => void) { effectRuns.push(run()) },
  }
  return { owner, scope, injected, registered, disposed, effectRuns }
}

const routes = [
  { path: HOST_ROUTES.approval.pending, methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response('ok') },
  { path: HOST_ROUTES.skillHealth.rows, methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response('ok') },
] as const

describe('host route registration (G4-S1)', () => {
  it('registers on the connection carrier with the deployment-level audit snapshot and disposes on fiber release', () => {
    const h = harness({ remote: true })
    let seenAudit: DecisionAudit | undefined
    registerHostRoutes(h.owner as never, (audit) => { seenAudit = audit; return routes })
    expect(h.injected).toHaveLength(1)
    expect(h.injected[0]?.names).toEqual(['connection'])
    h.injected[0]?.run(h.scope)
    expect(seenAudit).toEqual({ channel: 'connection.fetch', principal: 'owner', deploymentAllowsRemote: true })
    expect(h.registered.map(route => route.path)).toEqual([HOST_ROUTES.approval.pending, HOST_ROUTES.skillHealth.rows])
    expect(h.effectRuns).toHaveLength(1)
    h.effectRuns[0]?.()
    expect(h.disposed).toHaveLength(2)
  })

  it('fails loud with E-325 when the connection service is absent or the route path has no /api prefix', () => {
    const missing = harness({ noConnection: true })
    registerHostRoutes(missing.owner as never, () => routes)
    expect(() => missing.injected[0]?.run(missing.scope)).toThrow(/E-325/)
    const h = harness()
    registerHostRoutes(h.owner as never, () => ([{ path: '/dsh-evolution/approval/pending', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response('') }] as never))
    expect(() => h.injected[0]?.run(h.scope)).toThrow(/E-325/)
  })

  it('reports the host surface as unavailable without a connection (doctor source)', () => {
    expect(hostSurface({ get: () => undefined } as never)).toEqual({ available: false, code: 'E-325', reason: 'connection-missing' })
  })
})
