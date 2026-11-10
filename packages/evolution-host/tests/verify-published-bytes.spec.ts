// @tier pre-tag
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/verify-published-bytes.mjs', import.meta.url))
const VERSION = '9.9.9'
const NAME = 'lmzhen-dsh-evolution-core-9.9.9.tgz'

async function withRegistry(payload: Buffer, body: (base: string) => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => response.end(payload))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  try {
    await body('http://127.0.0.1:' + String(port))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

it('compares the registry tarball bytes without npm pack', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'published-bytes-'))
  const payload = Buffer.from('local-tarball-bytes')
  await writeFile(join(dir, NAME), payload)
  try {
    await withRegistry(payload, async (base) => {
      const result = await run(process.execPath, [script, dir, '--version', VERSION], {
        env: { ...process.env, REGISTRY_BASE: base },
        encoding: 'utf8',
      })
      expect(result.stdout).toContain('PASS @lmzhen/dsh-evolution-core@' + VERSION)
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('still fails a real byte difference', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'published-bytes-'))
  await writeFile(join(dir, NAME), Buffer.from('local-tarball-bytes'))
  try {
    await withRegistry(Buffer.from('registry-tarball-bytes'), async (base) => {
      await expect(run(process.execPath, [script, dir, '--version', VERSION], {
        env: { ...process.env, REGISTRY_BASE: base },
        encoding: 'utf8',
      })).rejects.toMatchObject({ code: 1 })
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
