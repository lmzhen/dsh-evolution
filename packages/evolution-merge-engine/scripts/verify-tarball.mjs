import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'dsh-engine-tarball-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const fail = message => { console.error('TARBALL FAIL: ' + message); process.exitCode = 1 }
try {
  const out = execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', work], { cwd: root, encoding: 'utf8', shell: true })
  const parsed = JSON.parse(out)
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
  const tgz = join(work, entry.filename)
  const extract = join(work, 'extract')
  execFileSync('tar', ['-xf', tgz, '-C', work])
  const pkg = join(work, 'package')
  for (const rel of ['data/minhash_params.json', 'lib/index.js', 'lib/vendor/skill-merge-pipeline/models/registry.json', 'lib/vendor/skill-merge-pipeline/models/pca64/proj.f32', 'vendor/skill-merge-pipeline/models/registry.json', 'vendor/skill-merge-pipeline/models/pca64/proj.f32']) {
    if (!existsSync(join(pkg, rel))) fail('missing ' + rel)
  }
  const mod = await import(pathToFileURL(join(pkg, 'lib', 'index.js')).href)
  if (typeof mod.screen !== 'function' || typeof mod.probe !== 'function') fail('module exports missing screen/probe')
  const manifest = JSON.parse(readFileSync(join(pkg, 'lib', 'build-manifest.json'), 'utf8'))
  if (manifest.version !== JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version) fail('manifest version mismatch')
  if (process.exitCode === undefined) console.log('TARBALL OK ' + manifest.version + ' exports=' + Object.keys(mod).length)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  rmSync(work, { recursive: true, force: true })
}