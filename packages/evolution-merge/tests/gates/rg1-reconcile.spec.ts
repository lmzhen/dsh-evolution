// @tier pre-tag
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { tempRoot } from '../../../test-support/temp-home.ts'

const fixtures = fileURLToPath(new URL('../fixtures/0.30.15/', import.meta.url))
const scripts = fileURLToPath(new URL('../../scripts/', import.meta.url))

it('reconciles identical dry-run reports and rejects a changed row', async () => {
  const home = await tempRoot('dsh-g1-reconcile-')
  mkdirSync(join(home, 'merge', 'receipts'), { recursive: true })
  mkdirSync(join(home, 'merge', 'journals'), { recursive: true })
  mkdirSync(join(home, 'merge', 'runs'), { recursive: true })
  copyFileSync(join(fixtures, 'state', 'five-states.json'), join(home, 'merge', 'merge-state.json'))
  const source = join(home, 'source.json')
  const target = join(home, 'target.json')
  const out = join(home, 'reconcile.json')
  execFileSync(process.execPath, [join(scripts, 'merge-source-snapshot.mjs'), '--home', home, '--out', source])
  execFileSync(process.execPath, [join(scripts, 'merge-migrate-dry-run.mjs'), '--home', home, '--out', target])
  execFileSync(process.execPath, [join(scripts, 'merge-reconcile.mjs'), '--source', source, '--target', target, '--out', out])
  expect(JSON.parse(readFileSync(out, 'utf8')).diffs).toEqual([])
  const changed = JSON.parse(readFileSync(target, 'utf8'))
  changed.pairs[0].target = 'changed-target'
  writeFileSync(target, JSON.stringify(changed))
  expect(() => execFileSync(process.execPath, [join(scripts, 'merge-reconcile.mjs'), '--source', source, '--target', target, '--out', out])).toThrow()
})
