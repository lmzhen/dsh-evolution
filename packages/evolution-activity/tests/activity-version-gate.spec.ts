import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { ACTIVITY_FILE_VERSION, isCorruptActivity, loadActivityState } from '../src/index.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

// v43 audit (H-3 / J-6 / FLOW6-6): the activity sidecar's read side ignored
// `version`, so a future-version file folded fine and was then rewritten as the
// current version on the next append — a silent downgrade. The write side now
// treats an unsupported version as corruption, which routes it through the
// existing quarantine (`<file>.corrupt`) before a current-version file replaces
// it — the same posture evolution-events takes for the identical shape.
const record = { planId: 'plan-1', sessionId: 'session-a', at: 1, memoryApplied: 0, skillApplied: 0 }
const body = (version: number | undefined): string =>
  JSON.stringify(version === undefined ? { items: [record] } : { version, items: [record] })

describe('activity sidecar version gate (H-3 / J-6)', () => {
  it('the current version and a missing version are both readable (the control)', () => {
    expect(isCorruptActivity(body(ACTIVITY_FILE_VERSION))).toBe(false)
    // A missing version is the legacy shape this reader has always accepted.
    expect(isCorruptActivity(body(undefined))).toBe(false)
    // A missing file is a first write, not corruption.
    expect(isCorruptActivity(null)).toBe(false)
  })

  it('a FUTURE version is corruption, so the bytes get quarantined instead of downgraded', () => {
    expect(isCorruptActivity(body(ACTIVITY_FILE_VERSION + 1))).toBe(true)
  })

  it('unparsable bytes and a wrong top-level shape stay corrupt (unchanged)', () => {
    expect(isCorruptActivity('{ not json')).toBe(true)
    expect(isCorruptActivity(JSON.stringify({ version: ACTIVITY_FILE_VERSION }))).toBe(true)
  })

  it('FLOW6-6: the READ path carries the verdict beside the records', async () => {
    // The read-only consumer (evolution-replay) could not tell "newer format"
    // from "no history": parseActivityContent answers [] for both. The verdict
    // is now part of the read result, so an empty list is qualifiable.
    const root = await tempRoot('dsh-activity-read-verdict-')
    const home = join(root, 'evolution')
    await mkdir(home, { recursive: true })
    const sidecar = join(home, 'activity.json')
    await writeFile(sidecar, body(ACTIVITY_FILE_VERSION + 1), 'utf8')
    const foreign = await loadActivityState(home, nodeEvolutionIo())
    // The reader still takes `items` as-is from a format it does not know (the
    // historical behavior), so the records can even be NON-empty — which is
    // exactly why the verdict has to travel beside them: a consumer cannot
    // otherwise tell this partial/foreign view from the recorded history.
    expect(foreign.corrupt).toBe(true)
    expect(Array.isArray(foreign.records)).toBe(true)
    await writeFile(sidecar, body(ACTIVITY_FILE_VERSION), 'utf8')
    const readable = await loadActivityState(home, nodeEvolutionIo())
    // The verdict is what this channel adds; the record validator's own rules
    // are pinned by activity-store.spec.ts.
    expect(readable.corrupt).toBe(false)
    expect(Array.isArray(readable.records)).toBe(true)
    // A missing file is a first write: records empty, NOT corrupt.
    expect(await loadActivityState(join(root, 'absent'), nodeEvolutionIo())).toEqual({ records: [], corrupt: false })
  })
})
