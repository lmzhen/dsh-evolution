import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const lib = join(root, 'lib')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = String(pkg.version)
const assetPaths = [
  'data/minhash_params.json',
  'lib/vendor/skill-merge-pipeline/models/registry.json',
  'lib/vendor/skill-merge-pipeline/models/pca64/proj.f32',
  'vendor/skill-merge-pipeline/models/registry.json',
  'vendor/skill-merge-pipeline/models/pca64/proj.f32',
]
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')

rmSync(lib, { recursive: true, force: true })
mkdirSync(join(lib, 'vendor', 'skill-merge-pipeline', 'models'), { recursive: true })
const sourcePath = join(root, 'src', 'index.bundle.js')
const source = readFileSync(sourcePath, 'utf8')
if (!/var VERSION = "[^"]*";/.test(source)) throw new Error('engine bundle has no VERSION marker')
const output = source.replace(/var VERSION = "[^"]*";/, 'var VERSION = "' + version + '";')
writeFileSync(join(lib, 'index.js'), output)
cpSync(join(root, 'src', 'index.d.ts'), join(lib, 'index.d.ts'))
for (const rel of ['registry.json', 'pca64']) {
  cpSync(join(root, 'vendor', 'skill-merge-pipeline', 'models', rel), join(lib, 'vendor', 'skill-merge-pipeline', 'models', rel), { recursive: true })
}
for (const rel of assetPaths) if (!existsSync(join(root, rel))) throw new Error('missing engine asset: ' + rel)
const manifest = {
  schemaVersion: 1,
  version,
  sourceBundleSha256: sha256(sourcePath),
  sourceBundleBytes: statSync(sourcePath).size,
  outputSha256: sha256(join(lib, 'index.js')),
  outputBytes: statSync(join(lib, 'index.js')).size,
  assets: assetPaths.map(path => ({ path, bytes: statSync(join(root, path)).size, sha256: sha256(join(root, path)) })),
}
writeFileSync(join(lib, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('engine build: ' + version + ' source=' + manifest.sourceBundleSha256.slice(0, 12) + ' output=' + manifest.outputSha256.slice(0, 12))