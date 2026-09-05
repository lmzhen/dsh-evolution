import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const scripts = fileURLToPath(new URL('../../scripts', import.meta.url))
const closure = join(scripts, 'verify-dependency-closure.mjs')
const archGuards = join(scripts, 'verify-arch-guards.mjs')
const eventPairing = join(scripts, 'verify-event-pairing.mjs')
// Guard scripts must fail loud on a vacuum scan (F-103 class) and stay correct
// on a violation — the "sentry" discipline: each guard gets one positive and
// one deliberate-violation run (0.3.26 V4-30).
const psRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('guard scripts (V4-30 sentry)', () => {
  it('dependency-closure passes on the real tree and fails on a vacuum root', async () => {
    const ok = await run(process.execPath, [closure, psRoot], { encoding: 'utf8' })
    expect(ok.stdout).toContain('OK')
    const empty = await mkdtemp(join(tmpdir(), 'guard-empty-'))
    try {
      await expect(run(process.execPath, [closure, empty], { encoding: 'utf8' })).rejects.toMatchObject({ code: 1 })
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('dependency-closure rejects an undeclared cross-package import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guard-closure-'))
    const pkg = join(root, 'demo-pkg')
    await mkdir(join(pkg, 'src'), { recursive: true })
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-demo-pkg', version: '0.0.0' }), 'utf8')
    await writeFile(join(pkg, 'src', 'index.ts'), "import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'\n", 'utf8')
    try {
      const error = await run(process.execPath, [closure, root], { encoding: 'utf8' }).then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
      expect(error).not.toBeNull()
      expect((error as { stderr?: string }).stderr).toContain('not declared')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('architecture guards pass strict on the real tree and fail on a vacuum root', async () => {
    const ok = await run(process.execPath, [archGuards, psRoot, '--strict'], { encoding: 'utf8' })
    expect(ok.stdout).toContain('OK')
    const empty = await mkdtemp(join(tmpdir(), 'guard-arch-empty-'))
    try {
      await expect(run(process.execPath, [archGuards, empty, '--strict'], { encoding: 'utf8' })).rejects.toMatchObject({ code: 1 })
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('architecture guards reject a DSH_HOME read outside core', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guard-arch-'))
    const pkg = join(root, 'demo-pkg')
    await mkdir(join(pkg, 'src'), { recursive: true })
    await writeFile(join(pkg, 'src', 'index.ts'), "const home = process.env.DSH_HOME ?? ''\n", 'utf8')
    try {
      const error = await run(process.execPath, [archGuards, root, '--strict'], { encoding: 'utf8' }).then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
      expect(error).not.toBeNull()
      expect((error as { stderr?: string }).stderr).toContain('DSH_HOME')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('event pairing reports zero orphans on the real tree and flags an unlistened emit', async () => {
    const ok = await run(process.execPath, [eventPairing, psRoot], { encoding: 'utf8' })
    expect(ok.stdout).toContain('0 orphan')
    const root = await mkdtemp(join(tmpdir(), 'guard-pairing-'))
    const pkg = join(root, 'demo-pkg')
    await mkdir(join(pkg, 'src'), { recursive: true })
    await writeFile(join(pkg, 'src', 'index.ts'), "ctx.emit('evolution/never-listened', {})\n", 'utf8')
    try {
      // A flagged orphan is a warning — the script still exits 0, but the
      // orphan name must appear on stderr.
      const out = await run(process.execPath, [eventPairing, root], { encoding: 'utf8' })
      expect(out.stderr).toContain('evolution/never-listened')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
