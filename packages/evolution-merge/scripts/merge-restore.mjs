import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const home = args.get('--home')
const backup = args.get('--backup')
if (!home || !backup) { console.error('usage: node scripts/merge-restore.mjs --home <home> --backup <dir>'); process.exit(2) }
const manifest = JSON.parse(readFileSync(join(backup, 'backup-manifest.json'), 'utf8'))
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const safe = rel => { const target = resolve(home, rel); const base = resolve(home) + sep; if (!target.startsWith(base)) throw new Error('unsafe backup path: ' + rel); return target }
for (const file of manifest.files) {
  const source = join(backup, file.path)
  if (!existsSync(source)) throw new Error('missing backup file: ' + file.path)
  if (sha(source) !== file.sha256 || statSync(source).size !== file.bytes) throw new Error('backup hash mismatch: ' + file.path)
  safe(file.path)
}
const temp = mkdtempSync(join(tmpdir(), 'dsh-merge-restore-'))
try {
  for (const file of manifest.files) {
    const source = join(backup, file.path)
    const staged = join(temp, file.path)
    mkdirSync(dirname(staged), { recursive: true })
    copyFileSync(source, staged)
  }
  for (const file of manifest.files) {
    const target = safe(file.path)
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(target)) renameSync(target, target + '.pre-restore')
    copyFileSync(join(temp, file.path), target)
  }
  console.log('MERGE RESTORE OK files=' + manifest.files.length)
} finally {
  rmSync(temp, { recursive: true, force: true })
}