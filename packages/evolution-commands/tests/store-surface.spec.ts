// @tier fast
import { describe, expect, it } from 'vitest'
import { STORE_SURFACE_COMMANDS, requireStoreSurfaceCommand } from '@deepseek-ai/dsh-evolution-core'
import { HOST_COMMAND_DEFS } from '../src/host-command-defs.ts'

describe('DCR-85 surface registry', () => {
  it('every host command has a registered command id', () => {
    for (const def of HOST_COMMAND_DEFS) expect(requireStoreSurfaceCommand(def.id).id).toBe(def.id)
  })

  it('every registered command id is a real host command', () => {
    const defined = new Set(HOST_COMMAND_DEFS.map(def => def.id))
    for (const command of STORE_SURFACE_COMMANDS.filter(entry => entry.kind === 'command')) {
      const subcommand = command.id.includes('.') && defined.has(command.id.slice(0, command.id.indexOf('.')))
      expect(defined.has(command.id) || subcommand, command.id).toBe(true)
    }
  })

  it('surface ids are unique', () => {
    const ids = STORE_SURFACE_COMMANDS.map(command => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
