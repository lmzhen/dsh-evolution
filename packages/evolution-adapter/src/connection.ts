/**
 * The connection half of the family's host platform boundary.
 *
 * The platform owns admission on the fetch carrier; the family only registers
 * exact routes and reports whether remote authorities are configured. A service
 * without `fetch.register` still exists as a port so `hostSurface` can report
 * the deployment fact, while registration fails loud at the call site.
 */
import type { Context } from '@deepseek-ai/cordis'
import { err, ok, type FamilyError, type Result } from '@deepseek-ai/dsh-evolution-contract/result'

export interface ConnectionRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered' | 'streaming'
  fetch(request: Request): Promise<Response>
}

export type ConnectionRegisterResult = Result<() => Promise<void>, FamilyError>

export interface ConnectionPort {
  readonly allowsRemoteAuthorities: boolean
  register(route: ConnectionRoute): () => Promise<void>
  /** Typed registration for callers that do not want to catch; optional during migration. */
  tryRegister?(route: ConnectionRoute): ConnectionRegisterResult
}

interface ConnectionFetchLike {
  register(route: ConnectionRoute): () => Promise<void>
}

interface ConnectionServiceLike {
  readonly allowsRemoteAuthorities?: boolean
  readonly fetch?: ConnectionFetchLike
}

const REGISTER_REQUIRED = 'connection.fetch.register() is required to register family host routes (platform >= 0.2.2-rc.1); no fallback admission path exists'

/** Resolve the connection port; undefined means the host has no connection service. */
export function connectionPort(ctx: Context): ConnectionPort | undefined {
  // platform-declaration anchor: connection is declared in core PLATFORM_SERVICE_PROBES.
  const connection = ctx.get('connection') as ConnectionServiceLike | undefined
  if (connection === undefined) return undefined
  const register = (route: ConnectionRoute): (() => Promise<void>) => {
    if (connection.fetch === undefined || typeof connection.fetch.register !== 'function') throw new Error(REGISTER_REQUIRED)
    return connection.fetch.register.call(connection.fetch, route)
  }
  return {
    allowsRemoteAuthorities: connection.allowsRemoteAuthorities === true,
    register,
    tryRegister: (route) => {
      try {
        return ok(register(route))
      } catch (error) {
        return err({ code: 'E-325', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}
