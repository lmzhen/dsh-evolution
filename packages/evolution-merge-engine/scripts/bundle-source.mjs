import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const repoRoot = resolve(root, '..', '..', '..')
const esbuild = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild')
const bundlePath = join(root, 'src', 'index.bundle.js')
const manifestPath = join(root, 'src', 'index.bundle.manifest.json')
const sha = b => createHash('sha256').update(b).digest('hex')

function walk(dir, base = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base === '' ? entry.name : base + '/' + entry.name
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
    else if (!rel.endsWith('index.bundle.js') && !rel.endsWith('index.bundle.manifest.json') && /\.(js|json)$/.test(rel)) out.push(rel)
  }
  return out
}

const files = [
  ...walk(join(root, 'src')).map(rel => 'src/' + rel),
  ...walk(join(root, 'vendor', 'skill-merge-pipeline', 'src')).map(rel => 'vendor/skill-merge-pipeline/src/' + rel),
].sort()
const sourceFiles = files.map(rel => ({ path: rel, sha256: sha(Buffer.from(readFileSync(join(root, rel)).toString('utf8').replace(/\r\n/g, '\n'))) }))
const sourceSha256 = sha(Buffer.from(sourceFiles.map(file => file.path + '\0' + file.sha256).join('\n')))

const result = spawnSync(esbuild, [
  join(root, 'src', 'index.js'),
  '--bundle', '--format=esm', '--platform=node', '--target=node20',
  '--external:onnxruntime-node',
  '--outfile=' + bundlePath,
], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' })
if (result.error) throw result.error
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
const bundleSha256 = sha(readFileSync(bundlePath))
writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, entry: 'src/index.js', bundle: 'src/index.bundle.js', bundleSha256, sourceSha256, sourceFiles }, null, 2) + '\n')
console.log('bundle-source: source=' + sourceSha256.slice(0, 12) + ' bundle=' + bundleSha256.slice(0, 12))
