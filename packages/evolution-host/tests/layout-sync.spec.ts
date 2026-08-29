import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const guard = fileURLToPath(new URL('../../scripts/verify-layout-sync.mjs', import.meta.url))

async function fakeTrees(devContent: string, mirrorContent: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-layout-sync-'))
  const dev = join(root, 'dev')
  const mirror = join(root, 'mirror')
  await mkdir(dev)
  await mkdir(mirror)
  await writeFile(join(dev, 'a.mjs'), devContent)
  await writeFile(join(mirror, 'a.mjs'), mirrorContent)
  return { root, dev, mirror }
}

describe('verify-layout-sync (P1-② layout drift guard)', () => {
  it('requires both paths and refuses to run without them (M-5)', async () => {
    const error = await run(process.execPath, [guard], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('both required')
  })

  it('passes when scripts are identical modulo line endings', async () => {
    const { root, dev, mirror } = await fakeTrees('line one\nline two\n', 'line one\r\nline two\r\n')
    const { stdout } = await run(process.execPath, [guard, dev, mirror], { encoding: 'utf8' })
    expect(stdout).toContain('OK')
    await rm(root, { recursive: true, force: true })
  })

  it('fails and names the drifted file when content differs', async () => {
    const { root, dev, mirror } = await fakeTrees('line one\n', 'line one changed\n')
    const error = await run(process.execPath, [guard, dev, mirror], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('a.mjs')
    await rm(root, { recursive: true, force: true })
  })

  it('fails when a file exists on only one side', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-layout-sync-2-'))
    const dev = join(root, 'dev')
    const mirror = join(root, 'mirror')
    await mkdir(dev)
    await mkdir(mirror)
    await writeFile(join(dev, 'only-dev.mjs'), 'x')
    const error = await run(process.execPath, [guard, dev, mirror], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error?.stderr).toContain('only-dev.mjs')
    await rm(root, { recursive: true, force: true })
  })
})
