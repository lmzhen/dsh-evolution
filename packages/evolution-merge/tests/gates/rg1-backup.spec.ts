// @tier pre-tag
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { tempRoot } from '../../../test-support/temp-home.ts'

const script = fileURLToPath(new URL('../../scripts/', import.meta.url))

it('backs up merge data and restores it after mutation', async () => {
  const home = await tempRoot('dsh-g1-backup-')
  const out = await tempRoot('dsh-g1-backup-out-')
  mkdirSync(join(home, 'merge', 'receipts'), { recursive: true })
  mkdirSync(join(home, 'merge', 'journals'), { recursive: true })
  mkdirSync(join(home, 'merge', 'runs'), { recursive: true })
  writeFileSync(join(home, 'merge', 'merge-state.json'), JSON.stringify({ schemaVersion: 2, rows: [] }))
  writeFileSync(join(home, 'runs.json'), JSON.stringify({ runs: [] }))
  writeFileSync(join(home, 'merge', 'receipts', 'r.json'), JSON.stringify({ unitId: 'u' }))
  const quiesce = join(home, 'quiesce.json')
  writeFileSync(quiesce, JSON.stringify({ stopped: true }))
  expect(() => execFileSync(process.execPath, [join(script, 'merge-backup.mjs'), '--home', home, '--out', out])).toThrow()
  execFileSync(process.execPath, [join(script, 'merge-backup.mjs'), '--home', home, '--out', out, '--quiesce', quiesce])
  writeFileSync(join(home, 'merge', 'merge-state.json'), JSON.stringify({ schemaVersion: 2, rows: [{ id: 'changed' }] }))
  execFileSync(process.execPath, [join(script, 'merge-restore.mjs'), '--home', home, '--backup', out])
  expect(JSON.parse(readFileSync(join(home, 'merge', 'merge-state.json'), 'utf8')).rows).toEqual([])
  expect(existsSync(join(home, 'merge', 'receipts', 'r.json'))).toBe(true)
  const clean = await tempRoot('dsh-g1-backup-clean-')
  execFileSync(process.execPath, [join(script, 'merge-restore.mjs'), '--home', clean, '--backup', out])
  expect(readFileSync(join(clean, 'merge', 'merge-state.json'), 'utf8')).toBe(readFileSync(join(home, 'merge', 'merge-state.json'), 'utf8'))
  expect(existsSync(join(clean, 'merge', 'receipts', 'r.json'))).toBe(true)
})
