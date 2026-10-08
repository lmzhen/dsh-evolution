/**
 * G3: the legacy-namespace migration.
 *
 * The exit criteria of the design are all here: a legacy document maps onto the row ids and
 * canonical keys, a second run writes nothing, a stored value wins over the legacy one with a
 * warning, and a key no row can take is refused instead of written.
 */
import { describe, expect, it, vi } from 'vitest'
import { applyNamespaceMigration, classifyNamespaceMigration, NAMESPACE_MIGRATIONS, planNamespaceMigration } from '../src/index.ts'

/** A legacy document in the shape the platform's import leaves behind. */
function legacyDocument(): string {
  return [
    'evolution-memory:',
    '  memoryCharLimit: 2200',
    '  addDatePrefix: true',
    'evolution-tool-memory:',
    '  entryPreviewChars: 300',
    'evolution-skills:',
    '  descriptionStrict: true',
    'ui-chat:',
    '  transcriptView: standard',
  ].join('\n') + '\n'
}

describe('namespace migration (G3)', () => {
  it('derives the table from the registry: only the rows whose two names differ', () => {
    expect(NAMESPACE_MIGRATIONS.map(entry => entry.namespace + '->' + entry.rowId).sort()).toEqual([
      'evolution-memory->memory-files',
      'evolution-skills->tool-skill-manage',
      'evolution-tool-memory->tool-memory',
    ])
  })

  it('maps a legacy section onto its row, alias key included', () => {
    const plan = planNamespaceMigration(legacyDocument())
    expect(plan.entries.map(entry => entry.rowId).sort()).toEqual(['memory-files', 'tool-memory', 'tool-skill-manage'])
    const memory = plan.entries.find(entry => entry.rowId === 'memory-files')
    // `memoryCharLimit` is the deprecated spelling of `memoryChars`: the value moves to the
    // CANONICAL id, or the row would gain a key its schema does not declare.
    expect(memory?.values).toEqual([
      { source: 'memoryCharLimit', key: 'memoryChars', value: 2200 },
      { source: 'addDatePrefix', key: 'addDatePrefix', value: true },
    ])
    // The platform's own section is left alone, and is named in the plan.
    expect(plan.foreign).toEqual(['ui-chat'])
    expect(plan.skipped).toEqual([])
  })

  it('refuses a key no row declares instead of writing it', () => {
    const plan = planNamespaceMigration('evolution-skills:\n  skillContentChars: 40000\n  notAParameter: 7\n')
    expect(plan.skipped).toEqual([{ namespace: 'evolution-skills', key: 'notAParameter', reason: 'row `tool-skill-manage` has no such parameter' }])
    // The key the row DOES declare still travels: one stray key costs only itself.
    expect(plan.entries).toEqual([
      { namespace: 'evolution-skills', rowId: 'tool-skill-manage', values: [{ source: 'skillContentChars', key: 'skillContentChars', value: 40000 }] },
    ])
  })

  it('refuses a document that is not a mapping, and a section that is not one', () => {
    expect(() => planNamespaceMigration('- one\n- two\n')).toThrow(/not a mapping/)
    expect(() => planNamespaceMigration('evolution-memory: 5\n')).toThrow(/section `evolution-memory` is not a mapping/)
  })

  it('classifies a plan without writing: rows, equal keys, kept values, unserved rows', () => {
    const plan = planNamespaceMigration(legacyDocument())
    const decided = classifyNamespaceMigration(plan, rowId => rowId === 'memory-files'
      ? { user: { memoryChars: 2200, addDatePrefix: false } }
      : rowId === 'tool-memory' ? { user: { entryPreviewChars: 300 } } : undefined)
    // One row holds a key unchanged and one with a different stored value; the row this
    // composition does not serve is reported instead of written.
    expect(decided.write).toEqual([])
    expect(decided.unchanged).toEqual([
      { rowId: 'memory-files', key: 'memoryChars' },
      { rowId: 'tool-memory', key: 'entryPreviewChars' },
    ])
    expect(decided.conflicts).toEqual([{ rowId: 'memory-files', key: 'addDatePrefix', current: false, legacy: true }])
    expect(decided.skipped).toEqual([{ namespace: 'evolution-skills', key: 'descriptionStrict', reason: 'row `tool-skill-manage` is not served in this composition' }])
  })

  it('classifies every row a fresh document would write', () => {
    const decided = classifyNamespaceMigration(planNamespaceMigration(legacyDocument()), () => ({ user: {} }))
    expect(decided.write).toEqual([
      { rowId: 'memory-files', patch: { memoryChars: 2200, addDatePrefix: true } },
      { rowId: 'tool-memory', patch: { entryPreviewChars: 300 } },
      { rowId: 'tool-skill-manage', patch: { descriptionStrict: true } },
    ])
    expect(decided.conflicts).toEqual([])
    expect(decided.skipped).toEqual([])
  })

  it('applies exactly what the classifier decided, and warns once per kept value', async () => {
    const plan = planNamespaceMigration(legacyDocument())
    const read = (rowId: string) => rowId === 'memory-files'
      ? { user: { addDatePrefix: false } }
      : undefined
    const decided = classifyNamespaceMigration(plan, read)
    const update = vi.fn(async (_rowId: string, _patch: Readonly<Record<string, unknown>>): Promise<void> => {})
    const warn = vi.fn((_message: string): void => {})
    const report = await applyNamespaceMigration(plan, { read, update, warn })
    expect(report.written).toEqual(decided.write.map(row => ({ rowId: row.rowId, keys: Object.keys(row.patch) })))
    expect(report.conflicts).toEqual(decided.conflicts)
    expect(update.mock.calls.map(call => call[0])).toEqual(decided.write.map(row => row.rowId))
    expect(warn).toHaveBeenCalledTimes(decided.conflicts.length)
  })

  it('writes a row it does not already carry, and reports it', async () => {
    const plan = planNamespaceMigration(legacyDocument())
    const update = vi.fn(async (_rowId: string, _patch: Readonly<Record<string, unknown>>): Promise<void> => {})
    const warn = vi.fn((_message: string): void => {})
    const report = await applyNamespaceMigration(plan, { read: () => ({ user: {} }), update, warn })
    expect(update).toHaveBeenCalledTimes(3)
    expect(update.mock.calls.map(call => call[0]).sort()).toEqual(['memory-files', 'tool-memory', 'tool-skill-manage'])
    expect(update).toHaveBeenCalledWith('memory-files', { memoryChars: 2200, addDatePrefix: true })
    expect(report.written.map(row => row.rowId).sort()).toEqual(['memory-files', 'tool-memory', 'tool-skill-manage'])
    expect(report.conflicts).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('writes nothing on a second run: an equal stored value is left alone', async () => {
    const plan = planNamespaceMigration(legacyDocument())
    const update = vi.fn(async (_rowId: string, _patch: Readonly<Record<string, unknown>>): Promise<void> => {})
    const report = await applyNamespaceMigration(plan, {
      read: rowId => rowId === 'memory-files' ? { user: { memoryChars: 2200, addDatePrefix: true } } : { user: {} },
      update,
      warn: (_message: string): void => {},
    })
    // The idempotent half: `memory-files` needs no write at all, so its revision cannot move.
    expect(report.unchanged.filter(row => row.rowId === 'memory-files')).toHaveLength(2)
    expect(update.mock.calls.map(call => call[0]).sort()).toEqual(['tool-memory', 'tool-skill-manage'])
  })

  it('keeps the stored value over the legacy one and says so', async () => {
    const plan = planNamespaceMigration(legacyDocument())
    const update = vi.fn(async (_rowId: string, _patch: Readonly<Record<string, unknown>>): Promise<void> => {})
    const warn = vi.fn((_message: string): void => {})
    const report = await applyNamespaceMigration(plan, {
      read: rowId => rowId === 'memory-files' ? { user: { memoryChars: 999 } } : { user: {} },
      update,
      warn,
    })
    expect(report.conflicts).toEqual([{ rowId: 'memory-files', key: 'memoryChars', current: 999, legacy: 2200 }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('`memoryChars`')
    expect(update).toHaveBeenCalledWith('memory-files', { addDatePrefix: true })
  })

  // The `variant` install form keeps the model rows (tool-memory, tool-skill-manage) in an
  // agent preset: they are mounted per session, so the boot-time migration finds no section for
  // them. One unmounted row must not abort the rows that ARE mounted, and it must be reported.
  it('reports a row this composition does not serve instead of aborting the rest', async () => {
    const plan = planNamespaceMigration(legacyDocument())
    const update = vi.fn(async (_rowId: string, _patch: Readonly<Record<string, unknown>>): Promise<void> => {})
    const report = await applyNamespaceMigration(plan, {
      read: rowId => rowId === 'memory-files' ? { user: {} } : undefined,
      update,
      warn: (_message: string): void => {},
    })
    expect(update).toHaveBeenCalledTimes(1)
    expect(report.written.map(row => row.rowId)).toEqual(['memory-files'])
    expect(report.skipped.map(skip => skip.namespace + ':' + skip.key).sort()).toEqual([
      'evolution-skills:descriptionStrict',
      'evolution-tool-memory:entryPreviewChars',
    ])
    expect(String(report.skipped[0]?.reason)).toContain('is not served in this composition')
  })

  it('treats a document with no family section as nothing to do', () => {
    const plan = planNamespaceMigration('ui-chat:\n  transcriptView: standard\n')
    expect(plan.entries).toEqual([])
    expect(plan.empty).toEqual([])
    expect(plan.foreign).toEqual(['ui-chat'])
  })
})
