// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { resumeUndo } from '../src/undo-resume.ts'
import { writeUndoJournal } from '../src/domain/undo-journal.ts'
import type { MergeUndoPort } from '../src/undo-merge.ts'

/**
 * W9-commit-protocol §3.2 resume entry: it refuses when there is no readable journal, reports a
 * settled run as settled, and otherwise delegates to the same (idempotent) pass.
 */

const dir = (): string => mkdtempSync(join(tmpdir(), 'undo-resume-'))
const port = {} as unknown as MergeUndoPort

describe('resumeUndo', () => {
  it('refuses when no journal exists', async () => {
    const result = await resumeUndo({ io: nodeEvolutionIo(), home: dir(), runId: 'run-x', port, now: () => 0 })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/nothing to resume/)
  })

  it('refuses when the journal is unreadable instead of guessing', async () => {
    const home = dir()
    const io = nodeEvolutionIo()
    await io.writeText(join(home, 'merge', 'undo-journal', 'run-y.json'), '{broken')
    const result = await resumeUndo({ io, home, runId: 'run-y', port, now: () => 0 })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/nothing to resume/)
  })

  it('reports a settled journal as settled', async () => {
    const home = dir()
    const io = nodeEvolutionIo()
    await writeUndoJournal(io, home, {
      version: 1, runId: 'run-z', phase: 'settled',
      pairs: [{ pairKey: 'p1', unitId: 'u1', phase: 'done' }],
      updatedAt: new Date(0).toISOString(),
    })
    const result = await resumeUndo({ io, home, runId: 'run-z', port, now: () => 0 })
    expect(result).toMatchObject({ ok: true, message: expect.stringMatching(/already settled/) })
  })

  it('delegates a pending journal to the pass', async () => {
    const home = dir()
    const io = nodeEvolutionIo()
    await writeUndoJournal(io, home, {
      version: 1, runId: 'run-p', phase: 'running',
      pairs: [{ pairKey: 'p1', unitId: 'u1', phase: 'restore-source' }],
      updatedAt: new Date(0).toISOString(),
    })
    const result = await resumeUndo({ io, home, runId: 'run-p', port, now: () => 0 })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no commit receipt/)
  })
})
