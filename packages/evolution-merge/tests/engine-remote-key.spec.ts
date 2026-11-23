// @tier fast
import { expect, it } from 'vitest'
import { RemoteEmbedder } from '../../evolution-merge-engine/vendor/skill-merge-pipeline/src/embed/remote.js'

it('sends the explicit runtime credential to the remote embedding provider', async () => {
  const seen: string[] = []
  const embedder = new RemoteEmbedder('Qwen/Qwen3-Embedding-8B', {
    embed_remote_url: 'http://127.0.0.1:1/v1/embeddings',
    embed_max_chars: 8000,
    embed_batch: 16,
  }, {
    key: 'ui-sf-key',
    fetch: async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers.Authorization)
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }], usage: {} }), { status: 200 })
    },
  })
  const encoded = await embedder.encode(['skill text'])
  expect(encoded).toHaveLength(1)
  expect(seen).toEqual(['Bearer ui-sf-key'])
})
