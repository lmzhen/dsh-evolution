// @tier fast
import { describe, expect, it } from 'vitest'
import { parseSubcommand, subcommandOf } from '../src/parse.ts'

/**
 * G7.4 / audit F-3 + F-4: the two command-surface syntax defects, pinned at the parser.
 *
 * The surface used to answer each subcommand with its own regex, so these spellings were refused as
 * "not a subcommand" (F-4) and a missing value slid into the value slot (F-3). The parser is the ONE
 * place that decides the shape; the branches read its result.
 */
describe('parseSubcommand (C7 single parser, F-3/F-4)', () => {
  it('accepts the flag order the regex would have refused (F-4)', () => {
    const parsed = parseSubcommand('params --json --group review')
    expect(parsed).not.toHaveProperty('kind')
    const command = parsed as { name: string; flags: Map<string, string | true> }
    expect(command.name).toBe('params')
    expect(command.flags.get('group')).toBe('review')
    expect(command.flags.get('json')).toBe(true)
  })

  it('accepts the --flag=value spelling its sibling already accepted (F-4)', () => {
    const parsed = parseSubcommand('params --group=review')
    expect((parsed as { flags: Map<string, string | true> }).flags.get('group')).toBe('review')
  })

  it('keeps a flag VALUE case intact so the domain layer can name it (F-4)', () => {
    const parsed = parseSubcommand('params --group WRITE-CAPS')
    // The group is NOT lower-cased here: the branch compares it against the registry and answers
    // E-308 with the known-group list, which is the error a typo deserves.
    expect((parsed as { flags: Map<string, string | true> }).flags.get('group')).toBe('WRITE-CAPS')
  })

  it('answers a SYNTAX failure when a value flag has no value (F-3)', () => {
    const parsed = parseSubcommand('policy set a.b --expect')
    expect(parsed).toMatchObject({ kind: 'missing-value', name: 'policy', flag: 'expect' })
  })

  it('reads positionals in order and matches the name case-insensitively', () => {
    const parsed = parseSubcommand('POLICY SET a.b 5 --expect 3')
    const command = parsed as { name: string; flags: Map<string, string | true>; positionals: string[] }
    expect(command.name).toBe('policy')
    // Only the SUBCOMMAND name is lower-cased; positionals keep the caller's case (a skill name's
    // case can matter).
    expect(command.positionals).toEqual(['SET', 'a.b', '5'])
    expect(command.flags.get('expect')).toBe('3')
  })

  it('reads a SUB-FORM line and refuses an undeclared flag (C7 table)', () => {
    const declared = ['--timeout', '--facts']
    expect(subcommandOf('maintain status abc', 'maintain', 'status', declared)?.positionals[1]).toBe('abc')
    expect(subcommandOf('maintain status --foo', 'maintain', 'status', declared)).toBeNull()
    expect(subcommandOf('maintain report', 'maintain', 'report', declared)?.positionals).toEqual(['report'])
    expect(subcommandOf('maintain', 'maintain', 'status', declared)).toBeNull()
  })

  it('keeps a quoted run as ONE token (the restructure form)', () => {
    const parsed = parseSubcommand('restructure alpha "Two Words" refs/two.md')
    const command = parsed as { name: string; positionals: string[] }
    expect(command.name).toBe('restructure')
    expect(command.positionals).toEqual(['alpha', 'Two Words', 'refs/two.md'])
  })
})
