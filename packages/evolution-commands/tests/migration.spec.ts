/**
 * G3 caller half: locating the legacy document and running the migration through the
 * platform's own write.
 *
 * The point of these cases is the shape a REAL deployment has: the platform renamed the
 * document, the settings seat is injected (not imported), and the write must reach the
 * current row id. Every driver is a fake, so the whole path is exercised without a host.
 */
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { legacySettingsPaths, readLegacyDocumentState, renderNamespaceMigration, runNamespaceMigration } from '../src/migration.ts'

/** The two document paths, spelled the way the module spells them (platform-native join). */
const IMPORTED = (home: string): string => join(home, 'settings.yaml.imported')
const PLAIN = (home: string): string => join(home, 'settings.yaml')

/** The legacy document the platform's import leaves behind. */
const LEGACY = [
  'evolution-memory:',
  '  memoryCharLimit: 2200',
  'ui-chat:',
  '  transcriptView: standard',
  '',
].join('\n')

/** One settings seat holding one row's user layer. */
function seat(user: Record<string, unknown> = {}) {
  const writes: { rowId: string; patch: Record<string, unknown> }[] = []
  return {
    writes,
    provider: {
      describe: (_options?: { redactSecrets?: boolean }) => [{ ns: 'memory-files', user }],
      update: async (rowId: string, patch: object) => { writes.push({ rowId, patch: patch as Record<string, unknown> }) },
    },
  }
}

/** The IO seam, reduced to the read this module performs. */
function io(files: Record<string, string>) {
  return { readText: async (path: string) => files[path] ?? null }
}

describe('namespace migration command (G3)', () => {
  it('reads the renamed document first, then an unimported settings.yaml', () => {
    const home = 'C:/home/profiles/web'
    expect(legacySettingsPaths(home)).toEqual([IMPORTED(home), PLAIN(home)])
  })

  it('migrates the renamed document into the current row id', async () => {
    const home = 'C:/home'
    const { writes, provider } = seat({})
    const outcome = await runNamespaceMigration({
      home,
      io: io({ [IMPORTED(home)]: LEGACY }) as never,
      settings: provider,
      warn: vi.fn((_message: string): void => {}),
    })
    expect(outcome.source).toBe(IMPORTED(home))
    // The legacy section name and the deprecated key spelling both disappear on the way in.
    expect(writes).toEqual([{ rowId: 'memory-files', patch: { memoryChars: 2200 } }])
    expect(renderNamespaceMigration(outcome)).toContain('写入：1 行')
  })

  it('reports what is left unmigrated without writing anything', async () => {
    const home = 'C:/home'
    const { writes, provider } = seat({})
    const state = await readLegacyDocumentState({ home, io: io({ [IMPORTED(home)]: LEGACY }) as never, settings: provider })
    expect(state).toEqual({ source: IMPORTED(home), sections: 1, pending: ['memory-files.memoryChars'], settled: [] })
    // Read-only: the doctor path must not write, which is the whole point of the shared classifier.
    expect(writes).toEqual([])
  })

  it('reports a fully migrated document as settled', async () => {
    const home = 'C:/home'
    const { provider } = seat({ memoryChars: 2200 })
    const state = await readLegacyDocumentState({ home, io: io({ [IMPORTED(home)]: LEGACY }) as never, settings: provider })
    expect(state).toEqual({ source: IMPORTED(home), sections: 1, pending: [], settled: ['memory-files.memoryChars'] })
  })

  it('answers undefined when there is no document, and when no settings seat is mounted', async () => {
    const home = 'C:/home'
    const { provider } = seat({})
    expect(await readLegacyDocumentState({ home, io: io({}) as never, settings: provider })).toBeUndefined()
    expect(await readLegacyDocumentState({ home, io: io({ [IMPORTED(home)]: LEGACY }) as never, settings: undefined })).toBeUndefined()
  })
  it('falls back to an unimported document when the platform import has not run', async () => {
    const home = 'C:/home'
    const { writes, provider } = seat({})
    const outcome = await runNamespaceMigration({
      home,
      io: io({ [PLAIN(home)]: LEGACY }) as never,
      settings: provider,
      warn: vi.fn((_message: string): void => {}),
    })
    expect(outcome.source).toBe(PLAIN(home))
    expect(writes).toHaveLength(1)
  })

  it('does nothing when no document exists, or when the document has no family section', async () => {
    const home = 'C:/home'
    const { writes, provider } = seat({})
    const missing = await runNamespaceMigration({ home, io: io({}) as never, settings: provider, warn: vi.fn() })
    expect(missing.source).toBeUndefined()
    expect(renderNamespaceMigration(missing)).toContain('没有找到旧设置文档')
    const foreign = await runNamespaceMigration({
      home,
      io: io({ [IMPORTED(home)]: 'ui-chat:\n  transcriptView: standard\n' }) as never,
      settings: provider,
      warn: vi.fn(),
    })
    expect(foreign.source).toBe(IMPORTED(home))
    expect(foreign.report).toBeUndefined()
    expect(renderNamespaceMigration(foreign)).toContain('没有家族的旧分区')
    expect(writes).toEqual([])
  })

  it('reports an already-migrated document as consistent and writes nothing', async () => {
    const home = 'C:/home'
    const { writes, provider } = seat({ memoryChars: 2200 })
    const outcome = await runNamespaceMigration({
      home,
      io: io({ [IMPORTED(home)]: LEGACY }) as never,
      settings: provider,
      warn: vi.fn(),
    })
    expect(writes).toEqual([])
    expect(renderNamespaceMigration(outcome)).toContain('已一致：1 个键')
  })

  it('does nothing without a settings seat to write through', async () => {
    const home = 'C:/home'
    const outcome = await runNamespaceMigration({
      home,
      io: io({ [IMPORTED(home)]: LEGACY }) as never,
      settings: undefined,
      warn: vi.fn(),
    })
    expect(outcome).toEqual({ source: undefined, plan: undefined, report: undefined })
  })
})
