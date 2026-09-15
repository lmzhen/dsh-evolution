/**
 * S3-5 (J-6 / H-3): ONE version-mismatch policy, pinned for every versioned
 * artifact the family writes.
 *
 * The policy (already the family's stated discipline in four writers' comments):
 * a file whose declared version is NEWER than this runtime understands is REFUSED
 * — the bytes are preserved byte-for-byte, the write does not happen, and the
 * refusal is reported (events THROWS `/version mismatch/`; the others warn).
 * The table below drives each writer against a future-version file so a future
 * change that starts downgrading one artifact fails HERE, not in production.
 *
 * Activity's sidecar is the same policy one step further (write side quarantines
 * the foreign bytes, read side reports the verdict): see
 * packages/evolution-activity/tests/activity-version-gate.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { appendEvolutionEvent, eventsFile, MUTATIONS_FILE_VERSION, mutateUsage, nodeEvolutionIo, recordMutation, saveSuppressedNames, SUPPRESSED_FILE_VERSION, suppressedFile, updateSuppressedNames, usageFile } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

interface Row {
  label: string
  /** The future-version bytes planted on disk. */
  body: string
  file: (root: string) => string
  /** The writer that must refuse: it reports, and the bytes stay untouched. */
  write: (root: string, io: ReturnType<typeof nodeEvolutionIo>) => Promise<void>
  /** Did the writer leave the artifact untouched? (`rejects` = fail loud.) */
  loud: 'reject' | 'warn'
  /** How THIS writer words the refusal (all four report; the wording differs). */
  report: RegExp
}

const ROWS: Row[] = [
  {
    label: 'evolution events (evolution-events.ts)',
    body: JSON.stringify({ version: 999, events: [] }, null, 2),
    file: root => eventsFile(root),
    write: async (root, io) => {
      await appendEvolutionEvent(io, eventsFile(root), { type: 'feedback', target: 'x', kind: 'skill', rating: 'positive' })
    },
    loud: 'reject',
    report: /version mismatch/,
  },
  {
    label: 'mutation audit (mutations.ts)',
    body: JSON.stringify({ version: MUTATIONS_FILE_VERSION + 1, records: [] }, null, 2),
    file: root => join(root, '.mutations.json'),
    write: async (root, io) => {
      await recordMutation(root, io, { name: 'demo', action: 'create', at: new Date().toISOString() } as never)
    },
    loud: 'warn',
    report: /newer than/,
  },
  {
    label: 'usage sidecar (usage.ts)',
    body: JSON.stringify({ version: 2, 'demo-skill': { use_count: 1, view_count: 0, patch_count: 0, created_at: new Date().toISOString() } }, null, 2),
    file: root => usageFile(root),
    write: async (root, io) => {
      await mutateUsage(root, io, (map) => { map.set('added', map.get('demo-skill')!) })
    },
    loud: 'warn',
    report: /schema version \d+ \(> this runtime\)/,
  },
  {
    label: 'suppression sidecar, plain writer (usage.ts)',
    body: JSON.stringify({ version: SUPPRESSED_FILE_VERSION + 1, names: ['kept'] }, null, 2),
    file: root => suppressedFile(root),
    write: async (root, io) => { await saveSuppressedNames(root, new Set(['other']), io) },
    loud: 'warn',
    report: /newer than/,
  },
]

describe('S3-5: a newer on-disk version is never downgraded (one policy, four writers)', () => {
  for (const row of ROWS) {
    it(`${row.label}: refuses, preserves the bytes, and says so`, async () => {
      const root = await tempRoot('dsh-version-policy-')
      const io = nodeEvolutionIo()
      const path = row.file(root)
      await io.writeText(path, row.body)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        if (row.loud === 'reject') {
          await expect(row.write(root, io)).rejects.toThrow(/version mismatch/)
        } else {
          await row.write(root, io)
          expect(warnSpy.mock.calls.some(call => row.report.test(String(call[0]))), `the refusal must be reported (${String(row.report)})`).toBe(true)
        }
        // The invariant that matters: the future bytes are still there, verbatim.
        expect(await io.readText(path)).toBe(row.body)
      } finally {
        warnSpy.mockRestore()
      }
    })
  }

  it('the suppression RMW writer both preserves the bytes and never runs its task', async () => {
    const root = await tempRoot('dsh-version-policy-rmw-')
    const io = nodeEvolutionIo()
    const path = suppressedFile(root)
    const future = JSON.stringify({ version: SUPPRESSED_FILE_VERSION + 1, names: ['kept'] }, null, 2)
    await io.writeText(path, future)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let taskRan = false
    try {
      await updateSuppressedNames(root, io, () => { taskRan = true })
    } finally {
      warnSpy.mockRestore()
    }
    expect(taskRan, 'a refused write must not apply the caller\u2019s mutation').toBe(false)
    expect(await io.readText(path)).toBe(future)
  })
})
