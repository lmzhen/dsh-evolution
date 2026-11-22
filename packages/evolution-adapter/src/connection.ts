/**
 * The connection implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import { err, ok } from './contract/result.ts'
import type { ConnectionPort, ConnectionRoute } from './contract/index.ts'

export type { ConnectionPort, ConnectionRegisterResult, ConnectionRoute } from './contract/index.ts'

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
