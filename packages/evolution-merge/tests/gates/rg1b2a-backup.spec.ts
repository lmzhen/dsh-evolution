// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { mergeStatePath } from '../../src/state.ts'
import { createPre1bBackup, readPre1bManifest } from '../../src/domain/pre-1b-backup.ts'

const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

it('backups every pre-1b source and is idempotent/read-only', async () => {
  const home = await tempRoot('dsh-rg1b2a-backup-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  await writeFile(mergeStatePath(home), JSON.stringify({ schemaVersion: 3, rows: [] }))
  const dirs = ['merge/staging-index', 'merge/runs/run-1/pairs/h', 'merge/run-meta', 'reports', 'merge/receipts', 'merge/journals', 'merge/unit-journals', 'merge/units']
  for (const dir of dirs) await mkdir(join(home, dir), { recursive: true })
  const files: Record<string, string> = {
    'runs.json': '{"runs":[]}', 'merge/staging-index/r1.json': '{"rowId":"r1"}', 'merge/runs/run-1/pairs/h/manifest.json': '{}',
    'merge/run-meta/run-1.json': '{}', 'reports/merge-run-1.json': '{}', 'merge/receipts/r.json': '{}',
    'merge/journals/j.json': '{}', 'merge/unit-journals/u.json': '{}', 'merge/units/u.json': '{}',
    'merge/pair-index.json': '{"pairs":[]}', 'merge/recovery.json': '[]',
  }
  for (const [rel, text] of Object.entries(files)) await writeFile(join(home, rel), text)
  const stateBefore = hash(await readFile(mergeStatePath(home), 'utf8'))
  const first = await createPre1bBackup(io, home, '2026-10-25T00:00:00.000Z')
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const manifest = await readPre1bManifest(io, home, first.id)
  expect(manifest).not.toBeNull()
  expect(manifest?.state.source).toBe(mergeStatePath(home))
  expect(manifest?.files.some(entry => entry.source.endsWith('runs.json'))).toBe(true)
  expect(manifest?.trees.map(entry => entry.source.slice(home.length + 1).replaceAll('\\', '/'))).toEqual(expect.arrayContaining(['merge/staging-index', 'merge/runs', 'merge/run-meta', 'reports', 'merge/receipts', 'merge/journals', 'merge/unit-journals', 'merge/units']))
  expect(hash(await readFile(mergeStatePath(home), 'utf8'))).toBe(stateBefore)
  expect((await stat(manifest!.state.copy)).mode & 0o222).toBe(0)
  const second = await createPre1bBackup(io, home, 'later')
  expect(second).toMatchObject({ ok: true, id: first.id })
  expect(hash(await readFile(mergeStatePath(home), 'utf8'))).toBe(stateBefore)
})
