// @tier pre-tag
import { expect, it } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/smoke-packed-install.mjs', import.meta.url))

async function fixture(options: { missingEntry?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-packed-smoke-'))
  const dist = join(root, 'dist')
  const src = join(root, 'src')
  const packageDir = join(src, 'package')
  const platform = join(root, 'platform')
  await mkdir(packageDir, { recursive: true })
  await mkdir(dist, { recursive: true })
  await mkdir(join(platform, '@deepseek-ai'), { recursive: true })
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({
    name: '@lmzhen/packed-fixture', version: '0.0.1', type: 'module',
    exports: { '.': './index.js' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  if (options.missingEntry !== true) await writeFile(join(packageDir, 'index.js'), 'export const ok = true\n')
  await writeFile(join(packageDir, 'cordis.patch.yml'), '- insert: []\n')
  execFileSync('tar', ['-czf', join(dist, 'packed-fixture.tgz'), '-C', src, 'package'])
  await writeFile(join(dist, 'manifest.json'), JSON.stringify({ '@lmzhen/packed-fixture': 'packed-fixture.tgz' }))
  return { root, dist, platform }
}

it('P2-33: a packed tarball is imported from a consumer node_modules', async () => {
  const { dist, platform } = await fixture()
  const { stdout } = await run(process.execPath, [script, dist, '--platform-node-modules', platform], { encoding: 'utf8' })
  expect(stdout).toContain('smoke-packed-install: OK')
})

it('P2-33: a tarball whose export target is missing fails the smoke', async () => {
  const { dist, platform } = await fixture({ missingEntry: true })
  const error = await run(process.execPath, [script, dist, '--platform-node-modules', platform], { encoding: 'utf8' })
    .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
  expect(error?.code).toBe(1)
  expect(error?.stderr).toContain('export target is absent from the tarball')
}, 30_000)
