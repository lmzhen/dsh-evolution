/**
 * The connection half of the family's platform contract.
 */
import type { FamilyError, Result } from './result.ts'

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
