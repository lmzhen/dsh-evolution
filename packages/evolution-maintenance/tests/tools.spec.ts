import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as MaintenanceTools from '../src/tools.ts'

describe('evolution-maintenance tools registration', () => {
  it('binds the register disposer to the plugin fiber (G4.2)', async () => {
    const ctx = new Context()
    const registered: Array<{ name?: string }> = []
    let removed = 0
    ctx.provide('tools', {
      register: (definition: { name?: string }) => {
        registered.push(definition)
        return () => { removed += 1 }
      },
      get: () => undefined,
    } as never)
    await ctx.plugin(MaintenanceTools, {})
    expect(registered.map(tool => tool.name)).toContain('maintenance_probe')
    expect(removed).toBe(0)
    // Disposing the fiber must run the register disposer: an HMR reload of
    // this plugin actually removes the tool instead of leaking the registration.
    await ctx.fiber.dispose()
    expect(removed).toBe(1)
  })
})
