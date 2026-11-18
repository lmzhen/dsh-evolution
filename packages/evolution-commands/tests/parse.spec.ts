// @tier fast
import { describe, expect, it } from 'vitest'
import { parseSubcommand } from '../src/parse.ts'

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
    const command = parsed as unknown as { name: string; flags: Map<string, string | true> }
    expect(command.name).toBe('params')
    expect(command.flags.get('group')).toBe('review')
    expect(command.flags.get('json')).toBe(true)
  })

  it('accepts the --flag=value spelling its sibling already accepted (F-4)', () => {
    const parsed = parseSubcommand('params --group=review')
    expect((parsed as unknown as { flags: Map<string, string | true> }).flags.get('group')).toBe('review')
  })

  it('keeps a flag VALUE case intact so the domain layer can name it (F-4)', () => {
    const parsed = parseSubcommand('params --group WRITE-CAPS')
    expect((parsed as unknown as { flags: Map<string, string | true> }).flags.get('group')).toBe('WRITE-CAPS')
  })

  it('answers a SYNTAX failure when a value flag has no value (F-3)', () => {
    const parsed = parseSubcommand('params --group')
    expect(parsed).toMatchObject({ kind: 'missing-value', name: 'params', flag: 'group' })
  })

  it('reads a value flag into the flag map', () => {
    const parsed = parseSubcommand('params --group review')
    const command = parsed as unknown as { name: string; flags: Map<string, string | true>; positionals: string[] }
    expect(command.name).toBe('params')
    expect(command.flags.get('group')).toBe('review')
    expect(command.positionals).toEqual([])
  })

  it('reads positionals in order and matches the name case-insensitively', () => {
    const parsed = parseSubcommand('LEARN a b heading')
    const command = parsed as unknown as { name: string; flags: Map<string, string | true>; positionals: string[] }
    expect(command.name).toBe('learn')
    // Only the SUBCOMMAND name is lower-cased; positionals keep the caller's case (a skill name's
    // case can matter).
    expect(command.positionals).toEqual(['a', 'b', 'heading'])
  })

  it('keeps a quoted run as ONE token', () => {
    const parsed = parseSubcommand('learn "Two Words"')
    const command = parsed as unknown as { name: string; positionals: string[] }
    expect(command.name).toBe('learn')
    expect(command.positionals).toEqual(['Two Words'])
  })
})
