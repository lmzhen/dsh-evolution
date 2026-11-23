// @tier pre-tag
import { expect, it, vi } from 'vitest'
import { resolveRetrievalCredentials } from '../src/domain/retrieval-credentials.ts'
import { RETRIEVAL_CREDENTIAL_REFS } from '../src/domain/retrieval-contract.generated.ts'

it('resolves both fixed refs from the platform credential provider', async () => {
  const resolve = vi.fn(async (ref: string) => ({ value: ref === RETRIEVAL_CREDENTIAL_REFS.embedding ? 'sf-key' : 'bamboo-key' }))
  const credentials = await resolveRetrievalCredentials({ get: name => name === 'credentials' ? { resolve } : undefined })
  expect(credentials).toEqual({ embedding: 'sf-key', ranker: 'bamboo-key' })
  expect(resolve.mock.calls.map(call => call[0])).toEqual([
    RETRIEVAL_CREDENTIAL_REFS.embedding,
    RETRIEVAL_CREDENTIAL_REFS.ranker,
  ])
})

it('reads absent records and an absent provider as undefined, never as empty strings', async () => {
  expect(await resolveRetrievalCredentials({ get: () => undefined })).toEqual({})
  expect(await resolveRetrievalCredentials({
    get: name => name === 'credentials' ? { resolve: async (ref: string) => ref === RETRIEVAL_CREDENTIAL_REFS.ranker ? { value: '' } : undefined } : undefined,
  })).toEqual({})
})

it('does not swallow a provider read failure', async () => {
  const failure = new Error('credential store unreadable')
  await expect(resolveRetrievalCredentials({
    get: name => name === 'credentials' ? { resolve: async () => { throw failure } } : undefined,
  })).rejects.toThrow('credential store unreadable')
})
