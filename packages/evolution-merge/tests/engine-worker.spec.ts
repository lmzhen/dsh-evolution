// @tier fast
import { expect, it, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tempRoot } from '../../test-support/temp-home.ts'
import { createProcessEngineScreen } from '../src/adapters/engine-screen.ts'

it('runs a local engine screen in a child process instead of the host loop', async () => {
  const root = await tempRoot('dsh-engine-worker-')
  const corpusDir = join(root, 'corpus')
  const outDir = join(root, 'engine')
  await mkdir(corpusDir, { recursive: true })
  const direct = vi.fn(async () => ({ ok: true as const, report: { direct: true } }))
  const port = createProcessEngineScreen(direct)
  const result = await port({ corpusDir, outDir, cfg: { judge: 'stub' } })
  expect(direct).not.toHaveBeenCalled()
  if (!result.ok) expect(String(result.error.detail ?? '')).not.toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME')
}, 60_000)
