import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
const doc = JSON.parse(readFileSync(join(root, 'UPSTREAM.json'), 'utf8'))
const sha = b => createHash('sha256').update(b).digest('hex')
let bad = 0
const patched = new Map([...(doc.testPatchSet ?? []), ...(doc.sourcePatchSet ?? [])].map(x => [x.path, x]))
const SOURCE_PATCH_ALLOWLIST = new Set([
  'node/src/scan.js',
  'node/src/stages/semantic.js',
  'node/src/stages/rerank.js',
  'node/src/screening/semantic.js',
  'node/src/rerank/index.js',
])
for (const entry of doc.sourcePatchSet ?? []) {
  if (!SOURCE_PATCH_ALLOWLIST.has(entry.path)) { console.error('SOURCE PATCH NOT ALLOWED', entry.path); bad++ }
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') { console.error('SOURCE PATCH WITHOUT REASON', entry.path); bad++ }
}
for (const e of doc.files) {
  const rel = e.path.replace(/^node\//, '')
  const p = join(root, 'vendor', 'skill-merge-pipeline', rel)
  if (!existsSync(p)) { console.error('MISSING', rel); bad++; continue }
  const b = readFileSync(p)
  const patch = patched.get(e.path)
  if (patch) {
    if (b.length !== patch.patchedBytes || sha(b) !== patch.patchedSha256) { console.error('PATCH MISMATCH', rel); bad++ }
    continue
  }
  if (b.length !== e.bytes || sha(b) !== e.sha256) { console.error('MISMATCH', rel); bad++ }
}
const sourcePatches = (doc.sourcePatchSet ?? []).length
console.log(bad === 0 ? 'ENGINE SUBSTANCE OK ' + doc.vendorFileCount + ' (declared credential patches: ' + sourcePatches + ')' : 'ENGINE SUBSTANCE FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
