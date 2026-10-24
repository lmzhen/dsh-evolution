import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const source = process.argv[2]
const dest = process.argv[3]
if (!source || !dest) { console.error('usage: node scripts/capture-real-fixture.mjs <rc0303-home> <fixture-root>'); process.exit(2) }
const pkg = JSON.parse(readFileSync(join(source, 'profiles', 'web', 'package.json'), 'utf8'))
const version = pkg.dependencies?.['@lmzhen/dsh-evolution-all'] ?? 'unknown'
const from = join(source, 'evolution', 'merge', 'merge-state.json')
const out = join(dest, 'real', 'merge', 'merge-state.json')
mkdirSync(join(dest, 'real', 'merge'), { recursive: true })
copyFileSync(from, out)
const capture = { sourceHost: source, packageVersion: version, capturedAt: new Date().toISOString(), file: 'real/merge/merge-state.json', sha256: createHash('sha256').update(readFileSync(out)).digest('hex') }
writeFileSync(join(dest, 'capture.json'), JSON.stringify(capture, null, 2) + '\n')
console.log('CAPTURED ' + version + ' ' + capture.sha256)
