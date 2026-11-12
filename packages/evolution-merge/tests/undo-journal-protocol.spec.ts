// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canAdvance, isTerminal } from '@deepseek-ai/dsh-evolution-core'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { readUndoJournal, UNDO_PAIR_PROTOCOL, writeUndoJournal } from '../src/domain/undo-journal.ts'

/**
 * W9-commit-protocol §3.1: the undo journal now has explicit `pair-index` and `run-meta` phases, and
 * a protocol that says what a restart may do. Without them a crash after the receipt left a pair
 * that every later pass refused as `undo-partial-state`.
 */

const dir = (): string => mkdtempSync(join(tmpdir(), 'undo-journal-'))

describe('undo journal protocol', () => {
  it('declares the full transition chain', () => {
    expect(canAdvance(UNDO_PAIR_PROTOCOL, 'receipt', 'pair-index')).toBe(true)
    expect(canAdvance(UNDO_PAIR_PROTOCOL, 'pair-index', 'run-meta')).toBe(true)
    expect(canAdvance(UNDO_PAIR_PROTOCOL, 'run-meta', 'done')).toBe(true)
    expect(canAdvance(UNDO_PAIR_PROTOCOL, 'receipt', 'done')).toBe(false)
    expect(isTerminal(UNDO_PAIR_PROTOCOL, 'done')).toBe(true)
    expect(isTerminal(UNDO_PAIR_PROTOCOL, 'pair-index')).toBe(false)
  })

  it('tells a restart to continue from every non-terminal phase', () => {
    expect(UNDO_PAIR_PROTOCOL.recoveryOf('pending')).toBe('retry')
    for (const phase of ['restore-target', 'restore-source', 'receipt', 'pair-index', 'run-meta'] as const) {
      expect(UNDO_PAIR_PROTOCOL.recoveryOf(phase)).toBe('continue')
    }
    expect(UNDO_PAIR_PROTOCOL.recoveryOf('done')).toBe('done')
  })

  it('round-trips the new phases through the journal file', async () => {
    const home = dir()
    const io = nodeEvolutionIo()
    await writeUndoJournal(io, home, {
      version: 1, runId: 'run-1', phase: 'running',
      pairs: [{ pairKey: 'p1', unitId: 'u1', phase: 'pair-index' }],
      updatedAt: new Date(0).toISOString(),
    })
    const read = await readUndoJournal(io, home, 'run-1')
    expect(read?.pairs[0]?.phase).toBe('pair-index')
  })

  it('returns null for a corrupt journal instead of guessing', async () => {
    const home = dir()
    const io = nodeEvolutionIo()
    const path = join(home, 'merge', 'undo-journal')
    await io.writeText(join(path, 'run-2.json'), '{not json')
    await expect(readUndoJournal(io, home, 'run-2')).resolves.toBeNull()
  })
})
