/**
 * G5: the platform read surfaces.
 *
 * The family reads the platform's management facts through services instead of scanning the
 * profile, so each surface must answer `undefined` when it is absent, throwing or misshaped —
 * the doctor renders that as a named line, never as an empty finding.
 */
import { describe, expect, it } from 'vitest'
import { readPlatformView } from '../src/platform-view.ts'

/** A context whose service store answers exactly the names it was given. */
function services(entries: Record<string, unknown>): { get(name: string): unknown } {
  return { get: (name: string): unknown => entries[name] }
}

/** One bundle row in the platform's own shape (the fields the doctor reads). */
const BUNDLE = {
  name: '@lmzhen/dsh-evolution-all',
  enabled: true,
  installed: true,
  optional: false,
  removable: true,
  rows: [{ rowId: 'memory-files', moduleName: '@deepseek-ai/dsh-memory-files' }],
  overrides: [],
}

describe('platform view (G5)', () => {
  it('answers undefined for every absent surface instead of guessing', async () => {
    expect(await readPlatformView(services({}))).toEqual({
      bundles: undefined, plugins: undefined, configuration: undefined, presets: undefined,
    })
  })

  it('reads the bundle, plugin and configuration surfaces the platform mounts', async () => {
    const view = await readPlatformView(services({
      pluginManager: {
        listBundles: (): unknown[] => [BUNDLE],
        listPlugins: (): unknown[] => [{ entryId: 'include:memory-files', enabled: true, fiberPhase: 'active' }],
      },
      configEditor: { configuration: (): unknown[] => [{ entry: { options: { id: 'memory-files' } }, inherited: {}, override: { memoryChars: 1600 } }] },
    }))
    expect(view.bundles?.[0]?.name).toBe('@lmzhen/dsh-evolution-all')
    expect(view.bundles?.[0]?.rows[0]?.rowId).toBe('memory-files')
    expect(view.plugins?.[0]?.entryId).toBe('include:memory-files')
    expect(view.configuration?.[0]?.override).toEqual({ memoryChars: 1600 })
    expect(view.presets).toBeUndefined()
  })

  it('prefers the base plugin surface, and falls back to the inventory entries', async () => {
    const entries = [{ entryId: 'include:evolution-review', enabled: true }]
    const withBase = await readPlatformView(services({
      pluginManager: { listPlugins: (): unknown[] => [{ entryId: 'from-base', enabled: true }] },
      pluginInventory: { list: async (): Promise<unknown> => ({ entries, agentPresets: [{ id: 'evolution', rows: [{ entryId: 'memory-files', moduleName: '@deepseek-ai/dsh-memory-files' }] }] }) },
    }))
    expect(withBase.plugins?.map(entry => entry.entryId)).toEqual(['from-base'])
    expect(withBase.presets?.[0]?.id).toBe('evolution')
    const inventoryOnly = await readPlatformView(services({
      pluginInventory: { list: async (): Promise<unknown> => ({ entries }) },
    }))
    expect(inventoryOnly.plugins?.map(entry => entry.entryId)).toEqual(['include:evolution-review'])
    expect(inventoryOnly.presets).toBeUndefined()
  })

  it('treats a throwing or misshaped surface as absent', async () => {
    const view = await readPlatformView(services({
      pluginManager: {
        listBundles: (): unknown => { throw new Error('boom') },
        listPlugins: (): unknown => 'nope',
      },
      configEditor: { configuration: (): unknown => ({ entry: 'x' }) },
      pluginInventory: { list: async (): Promise<unknown> => [1, 2] },
    }))
    expect(view).toEqual({ bundles: undefined, plugins: undefined, configuration: undefined, presets: undefined })
  })
})
