// @tier fast
import { describe, expect, it } from 'vitest'
import { COMMAND_ENTRIES, entryName, renderHelpText } from '../src/registry.ts'
import { HOST_COMMANDS } from '../src/generated/host-commands.ts'

const LOCALES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const

describe('B6: /evolution help in every supported locale', () => {
  it('has a translated summary for every command and no raw keys', () => {
    for (const locale of LOCALES) {
      const text = renderHelpText(locale)
      expect(text).toContain('/evolution subcommands (' + String(COMMAND_ENTRIES.length) + '):')
      expect(text).not.toContain('summary.')
      for (const entry of COMMAND_ENTRIES) {
        const summary = HOST_COMMANDS[('summary.' + entryName(entry)) as keyof typeof HOST_COMMANDS]?.[locale]
        expect(summary, locale + ' ' + entryName(entry)).toBeTruthy()
        expect(text).toContain(summary)
      }
    }
  })
})
