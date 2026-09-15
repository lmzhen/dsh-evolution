import { describe, expect, it } from 'vitest'
import { ACTIVITY_FILE_VERSION, isCorruptActivity } from '../src/index.ts'

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
})
