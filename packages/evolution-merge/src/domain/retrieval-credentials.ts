/**
 * Resolve the two optional retrieval API keys from the platform credential
 * seam once per scan. The values are runtime inputs to the engine; they never
 * enter cfg, report, run.meta, logs, or client snapshots.
 *
 * @module @deepseek-ai/dsh-evolution-merge/domain/retrieval-credentials
 */
import { RETRIEVAL_CREDENTIAL_REFS } from './retrieval-contract.generated.ts'

/** Optional API keys for the dedicated retrieval providers. */
export interface RetrievalCredentials {
  /** SiliconFlow embedding key; absent keeps the local embedding tiers. */
  readonly embedding?: string
  /** Bamboo/StartLux decision key; absent keeps the local/vector rank tiers. */
  readonly ranker?: string
}

/** The one credential-shaped fact this domain needs from a host context. */
export interface CredentialHost {
  get(name: string): unknown
}

interface CredentialResolver {
  resolve(ref: string): Promise<{ readonly value: string } | undefined>
}

function providerOf(host: CredentialHost): CredentialResolver | undefined {
  const value = host.get('credentials')
  if (value === null || typeof value !== 'object') return undefined
  const resolve = (value as { resolve?: unknown }).resolve
  return typeof resolve === 'function' ? value as CredentialResolver : undefined
}

async function read(credentials: CredentialResolver, ref: string): Promise<string | undefined> {
  const resolved = await credentials.resolve(ref)
  if (resolved === undefined || resolved.value === '') return undefined
  return resolved.value
}

/**
 * Resolve the fixed refs for one scan. Absent credentials service or absent
 * records read as undefined so the engine keeps its historical env fallback.
 * @param host - context exposing the optional platform credentials service.
 * @returns the two optional key values; no other fields and no source labels.
 */
export async function resolveRetrievalCredentials(host: CredentialHost): Promise<RetrievalCredentials> {
  const credentials = providerOf(host)
  if (credentials === undefined) return {}
  const embedding = await read(credentials, RETRIEVAL_CREDENTIAL_REFS.embedding)
  const ranker = await read(credentials, RETRIEVAL_CREDENTIAL_REFS.ranker)
  return {
    ...(embedding === undefined ? {} : { embedding }),
    ...(ranker === undefined ? {} : { ranker }),
  }
}
