/**
 * Family settings data plane.
 *
 * The platform RPC only serves its own namespace allowlist, so the browser cannot
 * reach family namespaces through /api/settings.* even though the underlying
 * settings service has them registered. These exact routes reuse the SAME
 * provider (describe/mutate), so storage, schema validation, revision conflicts
 * and redaction stay platform-owned; only the transport is family-scoped.
 * @module @deepseek-ai/dsh-evolution-commands/settings-route
 */
import { HOST_ROUTES, json, methodNotAllowed } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { ConnectionFetchRouteLike } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { PARAM_NAMESPACES, unwrapLive } from '@deepseek-ai/dsh-evolution-core'

interface SettingsDescriptorLike {
  ns: string
  value?: unknown
  user?: Record<string, unknown>
  base?: unknown
  revision?: number
  applies?: 'live' | 'restart'
}
interface SettingsProviderLike {
  readonly writable: boolean
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorLike[]
  mutate(ns: string, ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[], expectedRevision?: number): Promise<void>
}

const FAMILY_NAMESPACES = new Set(Object.keys(PARAM_NAMESPACES))

function normaliseValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const live = unwrapLive(field as never)
    out[key] = live === undefined ? field : live
  }
  return out
}

function snapshotOf(provider: SettingsProviderLike, descriptor: SettingsDescriptorLike | undefined): Record<string, unknown> {
  if (descriptor === undefined) {
    return { status: 'unavailable', writable: false, value: undefined, user: undefined, base: undefined, revision: undefined, reason: 'not-served' }
  }
  return {
    status: 'ready',
    writable: provider.writable,
    value: normaliseValue(descriptor.value),
    user: descriptor.user,
    base: descriptor.base,
    revision: descriptor.revision,
  }
}

function providerOf(getProvider: () => SettingsProviderLike | undefined): SettingsProviderLike | undefined {
  return getProvider()
}

/**
 * @param getProvider - resolves the live platform settings provider per request.
 * @returns exact routes for family settings describe/mutate.
 */
export function makeSettingsRoutes(getProvider: () => SettingsProviderLike | undefined): ConnectionFetchRouteLike[] {
  return [
    {
      path: HOST_ROUTES.settings.describe,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method !== 'GET') return methodNotAllowed(['GET'])
        const provider = providerOf(getProvider)
        if (provider === undefined) return json(503, { ok: false, error: 'settings-service-unavailable' })
        try {
          const all = provider.describe({ redactSecrets: true })
          const namespaces = all.filter(item => FAMILY_NAMESPACES.has(item.ns)).map(item => ({
            ns: item.ns,
            ...snapshotOf(provider, item),
          }))
          return json(200, { ok: true, data: { writable: provider.writable, namespaces } })
        } catch (error) {
          return json(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      path: HOST_ROUTES.settings.mutate,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method !== 'POST') return methodNotAllowed(['POST'])
        const provider = providerOf(getProvider)
        if (provider === undefined) return json(503, { ok: false, error: 'settings-service-unavailable' })
        let body: unknown
        try { body = await request.json() } catch { return json(400, { ok: false, error: 'invalid-json' }) }
        if (typeof body !== 'object' || body === null) return json(400, { ok: false, error: 'invalid-body' })
        const { ns, ops, expectedRevision } = body as { ns?: unknown; ops?: unknown; expectedRevision?: unknown }
        if (typeof ns !== 'string' || !FAMILY_NAMESPACES.has(ns)) return json(400, { ok: false, error: 'namespace-not-allowed' })
        if (!Array.isArray(ops) || ops.length === 0) return json(400, { ok: false, error: 'ops-required' })
        if (expectedRevision !== undefined && typeof expectedRevision !== 'number') return json(400, { ok: false, error: 'invalid-revision' })
        try {
          await provider.mutate(ns, ops as never, expectedRevision as number | undefined)
          const descriptor = provider.describe({ redactSecrets: true }).find(item => item.ns === ns)
          return json(200, { ok: true, data: { writable: provider.writable, namespaces: [{ ns, ...snapshotOf(provider, descriptor) }] } })
        } catch (error) {
          const code = (error as { code?: unknown } | null)?.code
          if (code === 'SETTINGS_CONFLICT') {
            return json(409, {
              ok: false,
              error: 'settings-conflict',
              actual: (error as { actual?: unknown }).actual,
              expected: (error as { expected?: unknown }).expected,
            })
          }
          return json(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
