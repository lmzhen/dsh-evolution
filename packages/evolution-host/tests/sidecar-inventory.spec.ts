import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// THE sidecar transaction inventory (release decisions v2 §8.3; archived in
// git history):
// every read-modify-write sidecar must run through io.transact via transactIo.
// Adding a new RMW sidecar requires a row here — this test is the door.
// Known granularity (v4 K-1 / v5 F-7): the gate checks marker presence per
// FILE, not per write point. Manual-review remainder: within an inventoried
// file, EVERY RMW write site must also go through transactIo — a new path
// added to a file that already carries the marker is not caught here.
//
// v21 (T-1): entries with a NAMED marker now check that FUNCTION's own body
// for transactIo. The old check was `source.includes('transactIo')` over the
// whole file plus a marker regex whose third branch matched call sites — so
// the inventoried function could be rewritten as a bare read+write while a
// sibling (or even a comment) kept the file-level substring green. Entries
// with marker 'transactIo' are file-level units (the whole module's RMW
// discipline is the contract) and keep the file-wide check.
const INVENTORY: Array<{ file: string; marker: string }> = [
  { file: 'evolution-core/src/usage.ts', marker: 'mutateUsage' },
  { file: 'evolution-core/src/usage.ts', marker: 'updateSuppressedNames' },
  { file: 'evolution-core/src/evolution-events.ts', marker: 'appendEvolutionEvent' },
  { file: 'evolution-core/src/mutations.ts', marker: 'recordMutation' },
  { file: 'evolution-activity/src/index.ts', marker: 'transactIo' },
  { file: 'evolution-feedback/src/index.ts', marker: 'transactIo' },
  { file: 'evolution-core/src/memory-store.ts', marker: 'transactIo' },
]

/** Extract the body of a top-level (possibly `export`ed/`async`) function
 * declaration: from the `function <marker>` keyword to the first line-start
 * closing brace. The inventoried sources are linted at 2-space indent, so
 * nested closers are indented and the first column-0 `}` closes the function. */
function functionBodyOf(source: string, marker: string): string | null {
  const match = new RegExp(`(async )?function ${marker}\\b`).exec(source)
  if (match === null) return null
  const end = source.indexOf('\n}', match.index)
  return end === -1 ? source.slice(match.index) : source.slice(match.index, end)
}

describe('sidecar transaction inventory (P1-③ decisions.md §8.3)', () => {
  it('every inventory entry implements its RMW through transactIo', async () => {
    const failures: string[] = []
    for (const entry of INVENTORY) {
      const source = await readFile(join(root, entry.file), 'utf8')
      if (entry.marker === 'transactIo') {
        if (!source.includes('transactIo')) {
          failures.push(`${entry.file}: missing transactIo-backed RMW`)
        }
        continue
      }
      const body = functionBodyOf(source, entry.marker)
      if (body === null) {
        failures.push(`${entry.file} (${entry.marker}): function not found — update the inventory`)
      } else if (!body.includes('transactIo')) {
        failures.push(`${entry.file} (${entry.marker}): the inventoried function no longer references transactIo (bare read+write RMW?)`)
      }
    }
    expect(failures).toEqual([])
  })

  it('the inventory stays in lockstep with the documented sidecar list', async () => {
    // The documented list (release decisions v2 §8.3, archived in git history)
    // names the sidecars: usage / suppressed / mutations / activity / feedback
    // (+ memory media) plus the rc.68 event log. The count is an EXACT pin
    // (v21 T-1 — the old `>= 7` could not see an entry being swapped):
    // adding or removing an inventory row is a deliberate contract change and
    // updates this number in the same diff.
    expect(INVENTORY.length).toBe(7)
  })
})
