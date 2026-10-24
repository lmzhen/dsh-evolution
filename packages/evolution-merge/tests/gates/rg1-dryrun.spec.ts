// @tier pre-tag
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { tempRoot } from '../../../test-support/temp-home.ts'

const fixtures = fileURLToPath(new URL('../fixtures/0.30.15/', import.meta.url))
const scripts = fileURLToPath(new URL('../../scripts/', import.meta.url))

it('dry-runs the 0.30.15 fixture without writing v3', async () => {
  const home = await tempRoot('dsh-g1-dryrun-')
  mkdirSync(join(home, 'merge', 'receipts'), { recursive: true })
  mkdirSync(join(home, 'merge', 'journals'), { recursive: true })
  mkdirSync(join(home, 'merge', 'runs'), { recursive: true })
  copyFileSync(join(fixtures, 'state', 'five-states.json'), join(home, 'merge', 'merge-state.json'))
  copyFileSync(join(fixtures, 'runs', 'succeeded.json'), join(home, 'runs.json'))
  copyFileSync(join(fixtures, 'receipts', 'complete.json'), join(home, 'merge', 'receipts', 'complete.json'))
  copyFileSync(join(fixtures, 'journals', 'prepared.json'), join(home, 'merge', 'journals', 'prepared.json'))
  const out = join(home, 'migration-dry-run.json')
  execFileSync(process.execPath, [join(scripts, 'merge-migrate-dry-run.mjs'), '--home', home, '--out', out])
  const report = JSON.parse(readFileSync(out, 'utf8'))
  expect(report.applied).toBe(false)
  expect(report.counts).toMatchObject({ verify: 1, pending: 1, approved: 1, fuse: 1, skipped: 1 })
  expect(report.wouldMigrate).toBe(5)
})
