// @tier pre-tag
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMergeCommand } from '../src/commands.ts'

function command(argv: string[]) {
  const parsed = parseMergeCommand(argv)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('unreachable')
  return parsed.command
}

test('parses the 19 command forms', () => {
  const forms = [
    ['scan'], ['pair', 'a', 'b'], ['pair', '--force', 'a', 'b'], ['status'], ['status', 'id'],
    ['report'], ['cancel'], ['runs'], ['doctor'], ['pending'], ['pending', '--expired'],
    ['candidates', '--retry'], ['approve', 'id'], ['reject', 'id'], ['resume'], ['resume', '--retry'],
    ['skipped', '--restore', 'id'], ['discard', 'id'], ['undo', 'target', '--run', 'r1'],
  ]
  assert.equal(forms.length, 19)
  for (const argv of forms) assert.equal(parseMergeCommand(argv).ok, true, argv.join(' '))
})

test('force/expired/retry switches keep positional args', () => {
  assert.deepEqual(command(['pair', '--force', 'a', 'b']), { verb: 'pair', a: 'a', b: 'b', force: true })
  assert.deepEqual(command(['pending', '--expired']), { verb: 'pending', expired: true })
  assert.deepEqual(command(['candidates', '--retry']), { verb: 'candidates', retry: true })
  assert.deepEqual(command(['resume', 'id', '--retry']), { verb: 'resume', id: 'id', retry: true })
  assert.deepEqual(command(['discard', 'id']), { verb: 'discard', id: 'id' })
})

test('rejects unknown flags and missing args', () => {
  assert.equal(parseMergeCommand(['discard']).ok, false)
  assert.equal(parseMergeCommand(['resume', '--nope']).ok, false)
})
