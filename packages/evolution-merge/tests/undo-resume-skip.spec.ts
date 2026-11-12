// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { undoMergeReceipt, type MergeUndoPort } from '../src/undo-merge.ts'
import type { CommitReceipt } from '../src/commit-receipt.ts'

/**
 * W9-commit-protocol §3.2: a resumed pass plans from the missing side only. Without the skip flags
 * a partial undo could never finish — the receipt's target is no longer in the live history, so the
 * pass refused exactly the retry the user was told to perform.
 */

const receipt = {
  runId: 'run-1', target: 't', sources: ['s1'], unitId: 'u1', create: false, at: 0,
} as unknown as CommitReceipt

function port(calls: string[]): MergeUndoPort {
  return {
    listVersions: async (skill: string) => { calls.push('list:' + skill); return [] },
    readSkill: async (skill: string) => { calls.push('read:' + skill); return 'body' },
    readSupport: async () => null,
    readBlob: async () => null,
    restoreFromArchive: async () => ({ ok: true }) as never,
    archive: async () => ({ ok: true }) as never,
    updateSkill: async () => ({ ok: true }) as never,
    writeSupportFile: async () => ({ ok: true }) as never,
  } as unknown as MergeUndoPort
}

describe('undoMergeReceipt: skip flags for a resumed pass', () => {
  it('does not plan the target when the target is already restored', async () => {
    const calls: string[] = []
    await undoMergeReceipt(receipt, port(calls), { skipTarget: true })
    expect(calls).not.toContain('list:t')
    expect(calls).toContain('read:s1')
  })

  it('does not touch the sources when they are already restored', async () => {
    const calls: string[] = []
    await undoMergeReceipt(receipt, port(calls), { skipSources: true })
    expect(calls).toContain('list:t')
    expect(calls).not.toContain('read:s1')
  })

  it('reports nothing left to restore when both sides are done', async () => {
    const calls: string[] = []
    const result = await undoMergeReceipt(receipt, port(calls), { skipTarget: true, skipSources: true })
    expect(result).toMatchObject({ ok: true })
    expect(calls).toEqual([])
  })
})
