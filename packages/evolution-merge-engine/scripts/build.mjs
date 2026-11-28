import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = resolve(root, '..', '..', '..')
// The published lib is derived from the checked-in bundle. Rebuild it when
// esbuild is installed; otherwise require the checked-in source fingerprint.
const esbuildPath = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild')
if (existsSync(esbuildPath)) {
  execFileSync(process.execPath, [join(root, 'scripts', 'bundle-source.mjs')], { cwd: root, stdio: 'inherit' })
}
execFileSync(process.execPath, [join(root, 'scripts', 'verify-bundle-fresh.mjs')], { cwd: root, stdio: 'inherit' })
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
const bundledRegistryPath = 'return path6.join(__dirname, "..", "..", "models", "registry.json");'
const shippedRegistryPath = 'return path6.join(__dirname, "vendor", "skill-merge-pipeline", "models", "registry.json");'
if (!source.includes(bundledRegistryPath)) throw new Error('engine bundle has no default registry path marker')
const output = source
  .replace(/var VERSION = "[^"]*";/, 'var VERSION = "' + version + '";')
  // The bundle flattens src/models/registry.js into lib/index.js, so its
  // two-level default path would resolve to node_modules/@lmzhen/models.
  // Point it at the registry copied beside the bundle instead.
  .replace(bundledRegistryPath, shippedRegistryPath)
if (!output.includes(shippedRegistryPath) || output.includes(bundledRegistryPath)) {
  throw new Error('engine bundle registry path rewrite failed')
}
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