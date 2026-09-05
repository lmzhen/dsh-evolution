import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
      "@deepseek-ai/dsh-tool-memory": ["./packages/evolution/tool-memory/src/index.ts"],
      "zod": ["./node_modules/.pnpm/zod@4.4.3/node_modules/zod"]
    }
  }
}
`

describe('inject-evolution-paths (N-7 purity)', () => {
  it('injects only evolution alias lines and preserves upstream rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-inject-'))
    const target = join(root, 'target.json')
    const mirror = join(root, 'mirror.json')
    await writeFile(target, TARGET)
    await writeFile(mirror, MIRROR)
    const { stdout } = await run(process.execPath, [injector, target, mirror], { encoding: 'utf8' })
    expect(stdout).toContain('injected 2 evolution alias line(s)')
    const next = await readFile(target, 'utf8')
    // Upstream rows survive, evolution lines land inside the paths block.
    expect(next).toContain('"@deepseek-ai/dsh-session"')
    expect(next).toContain('"@deepseek-ai/dsh-evolution-core"')
    expect(next).toContain('"@deepseek-ai/dsh-tool-memory"')
    // G5.6: `zod` is deliberately NOT injected — its pnpm-store path is
    // machine-specific, and a target that already declares it must not fail
    // the "already declares an evolution alias" check.
    expect(next).not.toContain('"zod"')
    await rm(root, { recursive: true, force: true })
  })

  it('fails loudly when the target already declares an evolution alias line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-inject-clash-'))
    const target = join(root, 'target.json')
    const mirror = join(root, 'mirror.json')
    await writeFile(target, TARGET.replace('"@deepseek-ai/dsh-session"', '"@deepseek-ai/dsh-session",\n      "@deepseek-ai/dsh-evolution-core": ["./packages/evolution/evolution-core/src/index.ts"]'))
    await writeFile(mirror, MIRROR)
    const error = await run(process.execPath, [injector, target, mirror], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('absorbed this row')
    await rm(root, { recursive: true, force: true })
  })
})
