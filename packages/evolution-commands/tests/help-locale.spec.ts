// @tier fast
import { describe, expect, it } from 'vitest'
import { HOST_COMMAND_DEFS, entryName, renderHelpText } from '../src/registry.ts'
import { HOST_COMMANDS } from '../src/generated/host-commands.ts'
import { hostCommandText } from '../src/host-locale.ts'

const LOCALES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const

describe('B6: /evolution help in every supported locale', () => {
  it('has a translated summary for every command and no raw keys', () => {
    for (const locale of LOCALES) {
      const text = renderHelpText(locale)
      expect(text).toContain(hostCommandText(locale, 'help.subcommands', { count: HOST_COMMAND_DEFS.length }))
      expect(text).not.toContain('summary.')
      for (const entry of HOST_COMMAND_DEFS) {
        const summary = HOST_COMMANDS[('summary.' + entryName(entry)) as keyof typeof HOST_COMMANDS]?.[locale]
        expect(summary, locale + ' ' + entryName(entry)).toBeTruthy()
        expect(text).toContain(summary)
      }
    }
  })
})
