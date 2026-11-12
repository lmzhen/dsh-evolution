// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { runUndoOperation } from '../src/undo-operation.ts'
import type { MergeUndoPort } from '../src/undo-merge.ts'

/**
 * W9-commit-protocol §3.2: the undo pass takes the caller's fence around the WHOLE pass. It used to
 * accept the fence and never use it, so two processes could restore the same run concurrently.
 */

const dir = (): string => mkdtempSync(join(tmpdir(), 'undo-fence-'))

const port = {
  listVersions: async () => [],
  readSkill: async () => null,
  writeSkill: async () => undefined,
  removeSkill: async () => undefined,
} as unknown as MergeUndoPort

describe('undo pass and the home fence', () => {
  it('runs the whole pass inside the supplied fence', async () => {
    const calls: string[] = []
    const fence = {
      run: async <T>(body: () => Promise<T>): Promise<T> => {
        calls.push('enter')
        try {
          return await body()
        } finally {
          calls.push('exit')
        }
      },
    }
    const result = await runUndoOperation({ io: nodeEvolutionIo(), home: dir(), runId: 'missing-run', port, now: () => 0, fence })
    expect(calls).toEqual(['enter', 'exit'])
    expect(result.ok).toBe(false)
  })

  it('surfaces a fence failure instead of running the pass unfenced', async () => {
    const fence = { run: async <T>(_body: () => Promise<T>): Promise<T> => { throw new Error('fence lost') } }
    await expect(runUndoOperation({ io: nodeEvolutionIo(), home: dir(), runId: 'run', port, now: () => 0, fence })).rejects.toThrow('fence lost')
  })
})
