// @tier pre-tag
import { expect, it } from 'vitest'
import { mergeUsage, parseMergeCommand } from '../src/index.ts'

it('parses the command surface', () => {
  expect(parseMergeCommand([])).toMatchObject({ ok: true, help: true })
  expect(parseMergeCommand(['pair', 'a', 'b'])).toEqual({ ok: true, command: { verb: 'pair', a: 'a', b: 'b' } })
  expect(parseMergeCommand(['status'])).toEqual({ ok: true, command: { verb: 'status' } })
  expect(parseMergeCommand(['resume', 'mr_1', '--clear', 'mr_2'])).toEqual({ ok: true, command: { verb: 'resume', id: 'mr_1', clear: 'mr_2' } })
  expect(parseMergeCommand(['skipped', '--restore', 'mr_1'])).toEqual({ ok: true, command: { verb: 'skipped', restore: 'mr_1' } })
  expect(parseMergeCommand(['undo', 'umbrella', '--run', 'run-1'])).toEqual({ ok: true, command: { verb: 'undo', target: 'umbrella', run: 'run-1' } })
})

it('rejects missing/unknown shapes with usage', () => {
  expect(parseMergeCommand(['undo', 'umbrella'])).toMatchObject({ ok: false, code: 'usage' })
  expect(parseMergeCommand(['approve'])).toMatchObject({ ok: false, code: 'usage' })
  expect(parseMergeCommand(['resume', '--unknown'])).toMatchObject({ ok: false, code: 'usage' })
  expect(mergeUsage()).toContain('merge scan')
})
