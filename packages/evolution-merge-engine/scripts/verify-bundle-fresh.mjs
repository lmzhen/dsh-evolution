import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
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
if (!existsSync(manifestPath) || !existsSync(bundlePath)) {
  console.error('verify-bundle-fresh: bundle or manifest missing; run npm run bundle:source')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const files = [
  ...walk(join(root, 'src')).map(rel => 'src/' + rel),
  ...walk(join(root, 'vendor', 'skill-merge-pipeline', 'src')).map(rel => 'vendor/skill-merge-pipeline/src/' + rel),
].sort()
const sourceFiles = files.map(rel => ({ path: rel, sha256: sha(readFileSync(join(root, rel))) }))
const sourceSha256 = sha(Buffer.from(sourceFiles.map(file => file.path + '\0' + file.sha256).join('\n')))
const problems = []
if (sourceSha256 !== manifest.sourceSha256) problems.push('source fingerprint changed')
if (JSON.stringify(sourceFiles) !== JSON.stringify(manifest.sourceFiles)) problems.push('source file list/hash changed')
if (sha(readFileSync(bundlePath)) !== manifest.bundleSha256) problems.push('bundle bytes changed')
if (problems.length > 0) {
  console.error('verify-bundle-fresh: ' + problems.join('; ') + '; run `node scripts/bundle-source.mjs` in an environment with esbuild')
  process.exit(1)
}
console.log('verify-bundle-fresh: OK ' + sourceSha256.slice(0, 12))
