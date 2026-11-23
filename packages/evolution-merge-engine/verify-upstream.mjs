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
  'node/src/stages/rerank.js',
  'node/src/screening/semantic.js',
  'node/src/rerank/index.js',
  'node/src/pipeline/index.js',
  'node/src/corpus.js',
  'node/src/extract.js',
])
const TEST_PATCH_PREFIXES = ['node/parity/', 'node/test/']
const SAFE_TREE_PATH = path => typeof path === 'string' && path.startsWith('node/') && !path.replace(/\\/g, '/').split('/').includes('..')
for (const entry of doc.testPatchSet ?? []) {
  if (!SAFE_TREE_PATH(entry.path)) { console.error('UNSAFE TEST PATCH PATH', entry.path); bad++ }
  if (!TEST_PATCH_PREFIXES.some(prefix => String(entry.path).startsWith(prefix))) { console.error('TEST PATCH OUTSIDE TEST TREE', entry.path); bad++ }
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') { console.error('TEST PATCH WITHOUT REASON', entry.path); bad++ }
}
for (const entry of doc.sourcePatchSet ?? []) {
  if (!SAFE_TREE_PATH(entry.path)) { console.error('UNSAFE SOURCE PATCH PATH', entry.path); bad++ }
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
const normalizeCredentialLines = b => b.toString('utf8').replace(/retrievalCredentials/g, 'RCRED').replace(/\bcredentials?\b/g, 'CRED')
const substance = doc.substance?.files
if (!Array.isArray(substance) || substance.length === 0) { console.error('SUBSTANCE MANIFEST MISSING'); bad++ }
else {
  for (const entry of substance) {
    if (typeof entry.path !== 'string' || typeof entry.purpose !== 'string' || entry.purpose.trim() === '') { console.error('SUBSTANCE ENTRY INVALID', String(entry.path)); bad++; continue }
    const full = join(root, entry.path)
    if (!existsSync(full)) { console.error('SUBSTANCE MISSING', entry.path); bad++; continue }
    const raw = readFileSync(full)
    const content = entry.mode === 'normalize' ? Buffer.from(normalizeCredentialLines(raw)) : raw
    if (content.length !== entry.bytes || sha(content) !== entry.sha256) { console.error('SUBSTANCE MISMATCH', entry.path); bad++ }
  }
}
const sourcePatches = (doc.sourcePatchSet ?? []).length
const fingerprints = Array.isArray(substance) ? substance.length : 0
console.log(bad === 0 ? 'ENGINE SUBSTANCE OK ' + doc.vendorFileCount + ' (declared credential patches: ' + sourcePatches + '; substantive fingerprints: ' + fingerprints + ')' : 'ENGINE SUBSTANCE FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
