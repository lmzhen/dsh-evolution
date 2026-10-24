import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(root, 'lib', 'build-manifest.json'), 'utf8'))
const upstream = JSON.parse(readFileSync(join(root, 'UPSTREAM.json'), 'utf8'))
const upstreamByPath = new Map((upstream.files ?? []).map(entry => [entry.path, entry]))
const assetUpstream = new Map([
  ['data/minhash_params.json', 'node/src/data/minhash_params.json'],
  ['lib/vendor/skill-merge-pipeline/models/registry.json', 'node/models/registry.json'],
  ['lib/vendor/skill-merge-pipeline/models/pca64/proj.f32', 'node/models/pca64/proj.f32'],
  ['vendor/skill-merge-pipeline/models/registry.json', 'node/models/registry.json'],
  ['vendor/skill-merge-pipeline/models/pca64/proj.f32', 'node/models/pca64/proj.f32'],
])
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const fail = message => { console.error('PACKAGE FAIL: ' + message); process.exitCode = 1 }
const check = (ok, message) => { if (!ok) fail(message) }

check(manifest.version === pkg.version, 'manifest version != package version')
check(sha(join(root, 'lib', 'index.js')) === manifest.outputSha256, 'lib/index.js sha != manifest')
if (existsSync(join(root, 'src', 'index.bundle.js'))) {
  check(sha(join(root, 'src', 'index.bundle.js')) === manifest.sourceBundleSha256, 'source bundle sha != manifest')
}
const libText = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
check(libText.includes('var VERSION = "' + pkg.version + '";'), 'lib/index.js VERSION != package version')
for (const asset of manifest.assets) {
  const path = join(root, asset.path)
  check(existsSync(path), 'missing asset ' + asset.path)
  if (existsSync(path)) check(sha(path) === asset.sha256, 'asset sha mismatch ' + asset.path)
  const upstreamPath = assetUpstream.get(asset.path)
  const upstreamEntry = upstreamPath === undefined ? undefined : upstreamByPath.get(upstreamPath)
  check(upstreamEntry !== undefined, 'no UPSTREAM entry for asset ' + asset.path)
  if (upstreamEntry !== undefined && existsSync(path)) {
    check(sha(path) === upstreamEntry.sha256, 'asset sha != UPSTREAM ' + asset.path)
    check(statSync(path).size === upstreamEntry.bytes, 'asset bytes != UPSTREAM ' + asset.path)
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
let packed
try {
  const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', shell: true })
  const parsed = JSON.parse(out)
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
  packed = entry.files.map(file => file.path)
} catch (error) {
  fail('npm pack --dry-run failed: ' + (error instanceof Error ? error.message : String(error)))
  packed = []
}
for (const required of ['data/minhash_params.json', 'lib/index.js', 'lib/index.d.ts', 'lib/build-manifest.json', 'lib/vendor/skill-merge-pipeline/models/registry.json', 'lib/vendor/skill-merge-pipeline/models/pca64/proj.f32', 'vendor/skill-merge-pipeline/models/registry.json', 'vendor/skill-merge-pipeline/models/pca64/proj.f32', 'LICENSE', 'NOTICE', 'UPSTREAM.json']) {
  check(packed.includes(required), 'tarball missing ' + required)
}
for (const file of packed) {
  check(!file.startsWith('vendor/src/'), 'tarball contains vendor/src: ' + file)
  check(!file.startsWith('vendor/test/'), 'tarball contains vendor/test: ' + file)
  check(!file.startsWith('vendor/parity/'), 'tarball contains vendor/parity: ' + file)
}
if (process.exitCode === undefined) console.log('ENGINE PACKAGE OK ' + pkg.version + ' files=' + packed.length)