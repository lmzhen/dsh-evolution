// @tier fast
import { describe, expect, it } from 'vitest'
import { parseCommand, type CommandDef } from '../src/command-catalog.ts'

const def = (id: string, words: readonly string[], positional: CommandDef['positional'] = []): CommandDef => ({
  id, words, summaryKey: 'summary.' + id, helpKey: 'help.' + id, flags: [], positional, readOnly: true, needsRun: false, fallback: id,
})

describe('parseCommand word prefixes', () => {
  it('prefers the longest matching words over the parent', () => {
    const defs = [def('maintain', ['maintain']), def('maintain.status', ['maintain', 'status'], [{ name: 'id', kind: 'id', required: false }])]
    expect(parseCommand(defs, ['maintain', 'status', 'run-1'])).toMatchObject({ ok: true, id: 'maintain.status', values: { id: 'run-1' } })
    expect(parseCommand(defs, ['maintain'])).toMatchObject({ ok: true, id: 'maintain' })
  })

  it('still answers unknown commands and help', () => {
    expect(parseCommand([], ['nope'])).toEqual({ ok: false, code: 'usage', message: 'unknown command: nope' })
    expect(parseCommand([], ['help'])).toMatchObject({ ok: true, id: 'help', help: true })
  })
})
