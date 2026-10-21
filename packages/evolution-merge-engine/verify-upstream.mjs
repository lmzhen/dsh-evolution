import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
const doc = JSON.parse(readFileSync(join(root, 'UPSTREAM.json'), 'utf8'))
const sha = b => createHash('sha256').update(b).digest('hex')
const patched = new Map((doc.testPatchSet ?? []).map(x => [x.path, x]))
let bad = 0
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
console.log(bad === 0 ? 'ENGINE UPSTREAM OK ' + doc.vendorFileCount : 'ENGINE UPSTREAM FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
