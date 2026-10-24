import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const home = args.get('--home')
const out = args.get('--out')
if (!home || !out) { console.error('usage: node scripts/merge-backup.mjs --home <home> --out <dir> [--quiesce <json>]'); process.exit(2) }
const quiesce = args.get('--quiesce')
if (!quiesce) { console.error('backup refused: --quiesce <json> required (stop plugin or fence writer)'); process.exit(2) }
try { if (JSON.parse(readFileSync(quiesce, 'utf8')).stopped !== true) { console.error('backup refused: writer not stopped'); process.exit(3) } } catch { console.error('backup refused: unreadable quiesce marker'); process.exit(3) }
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const roots = ['merge/merge-state.json', 'runs.json', 'merge/receipts', 'merge/journals', 'merge/runs', 'merge/snapshots']
const files = []
function walk(path) {
  if (!existsSync(path)) return
  const stat = statSync(path)
  if (stat.isDirectory()) { for (const name of readdirSync(path)) walk(join(path, name)); return }
  const rel = relative(home, path).replace(/\\/g, '/')
  files.push({ path: rel, bytes: stat.size, sha256: sha(path) })
}
for (const root of roots) walk(join(home, root))
mkdirSync(out, { recursive: true })
for (const file of files) {
  const target = join(out, file.path)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(home, file.path), target)
}
const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), home, quiesce: { path: quiesce, sha256: sha(quiesce) }, files }
writeFileSync(join(out, 'backup-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('MERGE BACKUP OK files=' + files.length + ' out=' + out)