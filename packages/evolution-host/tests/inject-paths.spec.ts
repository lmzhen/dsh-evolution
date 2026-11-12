// @tier ci-only
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempRoot } from '../../test-support/temp-home.ts'

const run = promisify(execFile)
const injector = fileURLToPath(new URL('../../scripts/inject-evolution-paths.mjs', import.meta.url))

const TARGET = `{
  "compilerOptions": {
    "paths": {
      "@deepseek-ai/dsh-session": ["./packages/core/session/src/index.ts"]
    }
  }
}
`
const MIRROR = `{
  "compilerOptions": {
    "paths": {
      "@deepseek-ai/dsh-evolution-core": ["./packages/evolution/evolution-core/src/index.ts"],
      "@deepseek-ai/dsh-evolution-deleted-package": ["./packages/evolution/evolution-deleted-package/src/index.ts"],
      "zod": ["./node_modules/.pnpm/zod@4.4.3/node_modules/zod"]
    }
  }
}
`

/** A family package the injector derives its aliases from: manifest exports + real sources. */
async function familyPackage(root: string, dir: string, name: string, exportsField: Record<string, string>, sources: string[]): Promise<void> {
  const pkgDir = join(root, 'packages', 'evolution', dir)
  await mkdir(join(pkgDir, 'src'), { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name, exports: exportsField }, null, 2))
  for (const source of sources) {
    const full = join(pkgDir, 'src', source)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, 'export {}\n')
  }
}

describe('inject-evolution-paths (N-7 purity, derived alias set)', () => {
  it('derives family aliases from the packages present and preserves upstream rows', async () => {
    const root = await tempRoot('dsh-inject-')
    const target = join(root, 'target.json')
    const mirror = join(root, 'mirror.json')
    await writeFile(target, TARGET)
    await writeFile(mirror, MIRROR)
    await familyPackage(root, 'evolution-core', '@deepseek-ai/dsh-evolution-core', { '.': './lib/index.js' }, ['index.ts'])
    await familyPackage(root, 'memory', '@deepseek-ai/dsh-memory', { '.': './lib/index.js', './tools': './lib/tools/index.js' }, ['index.ts', 'tools/index.ts'])
    const { stdout } = await run(process.execPath, [injector, target, mirror], { encoding: 'utf8' })
    expect(stdout).toContain('wrote 3 family alias(es)')
    const next = await readFile(target, 'utf8')
    // Upstream rows survive; derived aliases (root AND subpath) land inside the paths block.
    expect(next).toContain('"@deepseek-ai/dsh-session"')
    expect(next).toContain('"@deepseek-ai/dsh-evolution-core"')
    expect(next).toContain('"@deepseek-ai/dsh-memory/tools"')
    expect(next).toContain('./packages/evolution/memory/src/tools/index.ts')
    // The mirror argument is a cross-check only: a package absent from the checkout is never
    // injected — exactly the drift the old copy-the-mirror implementation shipped.
    expect(next).not.toContain('evolution-deleted-package')
    // G5.6: `zod` is deliberately NOT in the family set.
    expect(next).not.toContain('"zod"')
  })

  it('fails loudly when the target already declares a family alias line', async () => {
    const root = await tempRoot('dsh-inject-clash-')
    const target = join(root, 'target.json')
    const mirror = join(root, 'mirror.json')
    await writeFile(target, TARGET.replace('"@deepseek-ai/dsh-session"', '"@deepseek-ai/dsh-session",\n      "@deepseek-ai/dsh-evolution-core": ["./packages/evolution/evolution-core/src/index.ts"]'))
    await writeFile(mirror, MIRROR)
    await familyPackage(root, 'evolution-core', '@deepseek-ai/dsh-evolution-core', { '.': './lib/index.js' }, ['index.ts'])
    const error = await run(process.execPath, [injector, target, mirror], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('absorbed this row')
  })
})
