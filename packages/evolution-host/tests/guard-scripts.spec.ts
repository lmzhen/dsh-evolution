import { describe, expect, it, vi } from 'vitest'
// Child-process spawns slow down under full-suite parallel load; the vitest
// default 5s per test is too tight for multiple node spawns (audit v10 fix).
vi.setConfig({ testTimeout: 30_000 })
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempRoot } from '../../test-support/temp-home.ts'

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
    const empty = await tempRoot('guard-empty-')
    await expect(run(process.execPath, [closure, empty], { encoding: 'utf8' })).rejects.toMatchObject({ code: 1 })
  })

  it('dependency-closure rejects an undeclared cross-package import', async () => {
    const root = await tempRoot('guard-closure-')
    const pkg = join(root, 'demo-pkg')
    await mkdir(join(pkg, 'src'), { recursive: true })
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-demo-pkg', version: '0.0.0' }), 'utf8')
    await writeFile(join(pkg, 'src', 'index.ts'), "import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'\n", 'utf8')
    const error = await run(process.execPath, [closure, root], { encoding: 'utf8' }).then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect((error as { stderr?: string }).stderr).toContain('not declared')
  })

  it('architecture guards pass strict on the real tree and fail on a vacuum root', async () => {
    const ok = await run(process.execPath, [archGuards, psRoot, '--strict'], { encoding: 'utf8' })
    expect(ok.stdout).toContain('OK')
    const empty = await tempRoot('guard-arch-empty-')
    await expect(run(process.execPath, [archGuards, empty, '--strict'], { encoding: 'utf8' })).rejects.toMatchObject({ code: 1 })
  })

  it('architecture guards reject a DSH_HOME read outside core', async () => {
    const root = await tempRoot('guard-arch-')
    const pkg = join(root, 'demo-pkg')
    await mkdir(join(pkg, 'src'), { recursive: true })
    await writeFile(join(pkg, 'src', 'index.ts'), "const home = process.env.DSH_HOME ?? ''\n", 'utf8')
    const error = await run(process.execPath, [archGuards, root, '--strict'], { encoding: 'utf8' }).then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect((error as { stderr?: string }).stderr).toContain('DSH_HOME')
  })

  it('event pairing reports zero orphans on the real tree and flags an unlistened emit', async () => {
    const ok = await run(process.execPath, [eventPairing, psRoot], { encoding: 'utf8' })
    expect(ok.stdout).toContain('0 orphan')
    const root = await tempRoot('guard-pairing-')
    const pkg = join(root, 'demo-pkg')
    await mkdir(join(pkg, 'src'), { recursive: true })
    await writeFile(join(pkg, 'src', 'index.ts'), "ctx.emit('evolution/never-listened', {})\n", 'utf8')
    // A flagged orphan is a warning — the script still exits 0, but the
    // orphan name must appear on stderr.
    const out = await run(process.execPath, [eventPairing, root], { encoding: 'utf8' })
    expect(out.stderr).toContain('evolution/never-listened')
    // V5-16: a camelCase `<x>ctx.on` receiver must count as a consumer — the
    // old `\w*ctx` regex was case-sensitive and missed ioCtx entirely (the
    // very shape activity uses for plan-applied), so this sibling of the
    // emit-only tree must flip the report to zero orphans.
    await writeFile(join(pkg, 'src', 'consumer.ts'), "ioCtx.on('evolution/never-listened', () => {})\n", 'utf8')
    const paired = await run(process.execPath, [eventPairing, root], { encoding: 'utf8' })
    expect(paired.stdout).toContain('0 orphan')
    // V6-46 (0.3.37): the EMIT side must see the same camelCase receivers —
    // an `ioCtx.emit` producer used to be invisible to the emitter regex and
    // counted as zero orphans while the receiver never ran.
    await writeFile(join(pkg, 'src', 'emit.ts'), "ioCtx.emit('evolution/never-listened-twice', {})\n", 'utf8')
    const unpaired = await run(process.execPath, [eventPairing, root], { encoding: 'utf8' })
    expect(unpaired.stderr).toContain('evolution/never-listened-twice')
  })

  it('R-03: arch-guards and event-pairing report usage (exit 2) on a missing root', async () => {
    // A wrong root used to surface as a raw ENOENT from readdirSync; both
    // guards now print the usage line like verify-dependency-closure.
    const missing = join(tmpdir(), 'guard-missing-root-does-not-exist')
    for (const guard of [archGuards, eventPairing]) {
      const error = await run(process.execPath, [guard, missing], { encoding: 'utf8' })
        .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
      expect(error).not.toBeNull()
      expect(error?.code).toBe(2)
      expect(error?.stderr).toContain('usage:')
      expect(error?.stderr).toContain(missing)
    }
  })

  it('G4.1 (v33): declared-config recomputes the platform planes and fails loud on drift', async () => {
    const declaredConfig = join(scripts, 'verify-declared-config.mjs')
    // Positive: the real tree with no platform checkout behaves as before.
    const ok = await run(process.execPath, [declaredConfig, psRoot, '--strict'], { encoding: 'utf8' })
    expect(ok.stdout).toContain('0 upstream-drift violation(s)')
    // Violation: a platform tree whose base plane does not carry the rows the
    // snapshot lists. The recomputation must report the drift instead of
    // accepting a partial (or empty) plane as agreement.
    const tree = await tempRoot('guard-declared-')
    const plane = join(tree, 'packages', 'bundle', 'base')
    await mkdir(plane, { recursive: true })
    await writeFile(
      join(plane, 'cordis.patch.yml'),
      "- id: timer\n  name: '@deepseek-ai/dsh-timer'\n- id: skill-badge\n  name: '@deepseek-ai/dsh-skill-badge'\n  disabled: true\n",
      'utf8',
    )
    const error = await run(process.execPath, [declaredConfig, psRoot, '--strict', '--upstream', tree], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('upstream-planes-drift')
  })

  it('G4.2 (v33): platform-contract names the recorded anchors an empty tree lacks', async () => {
    const contract = join(scripts, 'verify-platform-contract.mjs')
    // Vacuity sentry: with no platform tree present, every recorded anchor is
    // reported by name — the probe can never pass by finding nothing.
    const empty = await tempRoot('guard-contract-')
    const error = await run(process.execPath, [contract, psRoot, '--upstream', empty], { encoding: 'utf8' })
      .then(() => null, (caught: unknown) => caught as { code?: number; stderr?: string })
    expect(error).not.toBeNull()
    expect(error?.code).toBe(1)
    expect(error?.stderr).toContain('host-surface difference')
    expect(error?.stderr).toContain('session-events-accessor')
  })
})
