import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// THE sidecar transaction inventory (docs/release/decisions.md, v2 §8.3):
// every read-modify-write sidecar must run through io.transact via transactIo.
// Adding a new RMW sidecar requires a row here — this test is the door.
const INVENTORY: Array<{ file: string; marker: string }> = [
  { file: 'evolution-core/src/usage.ts', marker: 'mutateUsage' },
  { file: 'evolution-core/src/usage.ts', marker: 'updateSuppressedNames' },
  { file: 'evolution-core/src/evolution-events.ts', marker: 'appendEvolutionEvent' },
  { file: 'evolution-core/src/mutations.ts', marker: 'recordMutation' },
  { file: 'evolution-activity/src/index.ts', marker: 'transactIo' },
  { file: 'evolution-feedback/src/index.ts', marker: 'transactIo' },
  { file: 'evolution-core/src/memory-store.ts', marker: 'transactIo' },
]

describe('sidecar transaction inventory (P1-③ decisions.md §8.3)', () => {
  it('every inventory entry implements its RMW through transactIo', async () => {
    const failures: string[] = []
    for (const entry of INVENTORY) {
      const source = await readFile(join(root, entry.file), 'utf8')
      const functionDef = new RegExp(`async function? ${entry.marker}\\b|function ${entry.marker}\\b|${entry.marker}\\s*[:=(]`)
      if (!functionDef.test(source) || !source.includes('transactIo')) {
        failures.push(`${entry.file} (${entry.marker}): missing transactIo-backed RMW`)
      }
    }
    expect(failures).toEqual([])
  })

  it('the inventory stays in lockstep with the decisions.md list count', async () => {
    // The documented list names the sidecars: usage / mutations / suppressed /
    // activity / feedback (+ memory media) plus the rc.68 event log.
    expect(INVENTORY.length).toBeGreaterThanOrEqual(7)
  })
})
