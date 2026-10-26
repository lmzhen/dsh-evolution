// @tier pre-tag
import { expect, it } from 'vitest'
import { mergeUsage, parseMergeCommand } from '../src/index.ts'
import { forcedDecisionFor } from '../src/runtime.ts'

it('parses the command surface', () => {
  expect(parseMergeCommand([])).toMatchObject({ ok: true, help: true })
  expect(parseMergeCommand(['pair', 'a', 'b'])).toEqual({ ok: true, command: { verb: 'pair', a: 'a', b: 'b' } })
  expect(parseMergeCommand(['status'])).toEqual({ ok: true, command: { verb: 'status' } })
  expect(parseMergeCommand(['doctor'])).toEqual({ ok: true, command: { verb: 'doctor' } })
  expect(parseMergeCommand(['resume', 'mr_1', '--clear', 'mr_2'])).toEqual({ ok: true, command: { verb: 'resume', id: 'mr_1', clear: 'mr_2' } })
  expect(parseMergeCommand(['skipped', '--restore', 'mr_1'])).toEqual({ ok: true, command: { verb: 'skipped', restore: 'mr_1' } })
  expect(parseMergeCommand(['undo', 'umbrella', '--run', 'run-1'])).toEqual({ ok: true, command: { verb: 'undo', target: 'umbrella', run: 'run-1' } })
})

it('maps candidates/pending/resume and forced pair commands', () => {
  expect(parseMergeCommand(['candidates'])).toMatchObject({ ok: true, command: { verb: 'candidates' } })
  expect(parseMergeCommand(['candidates', '--retry', 'mr_1'])).toMatchObject({ ok: true, command: { verb: 'candidates', retry: true, id: 'mr_1' } })
  expect(parseMergeCommand(['pending', '--expired'])).toMatchObject({ ok: true, command: { verb: 'pending', expired: true } })
  expect(parseMergeCommand(['resume', '--retry', 'mr_1'])).toMatchObject({ ok: true, command: { verb: 'resume', retry: true, id: 'mr_1' } })
  expect(forcedDecisionFor('b', 'a')).toMatchObject({ shouldMerge: true, mode: 'create-umbrella', target: 'merge-a-b', sources: ['b', 'a'] })
})

it('rejects missing/unknown shapes with usage', () => {
  expect(parseMergeCommand(['undo', 'umbrella'])).toMatchObject({ ok: false, code: 'usage' })
  expect(parseMergeCommand(['approve'])).toMatchObject({ ok: false, code: 'usage' })
  expect(parseMergeCommand(['resume', '--unknown'])).toMatchObject({ ok: false, code: 'usage' })
  expect(mergeUsage()).toContain('merge scan')
})
