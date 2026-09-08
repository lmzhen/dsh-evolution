import { describe, expect, it } from 'vitest'
import {
  CURATOR_STATE_FILE,
  CURATOR_STATE_KEY,
  CURATOR_STATE_TABLE,
  PENDING_ARCHIVE_BAK_FILE,
  PENDING_ARCHIVE_FILE,
  PENDING_LEGACY_FILE,
  PENDING_STATE_FILE,
  PENDING_TABLE,
  PROVIDER_DOMAIN,
  PROVIDER_JSON,
  REVIEW_STATE_FILE,
  REVIEW_STATE_TABLE,
} from '../src/index.ts'

describe('S-06: state-stack magic strings are single-sourced', () => {
  it('pins the format-stable literals', () => {
    // These values are on-disk / registry / domain-spec CONTRACTS: the file
    // names and the singleton key name real persisted data, the provider
    // names are seam registry keys, the table names are domain-spec keys.
    // A rename orphans data or breaks the seam — this test turns any drift
    // into a loud failure instead of a silent format break.
    expect(CURATOR_STATE_KEY).toBe('primary')
    expect(REVIEW_STATE_FILE).toBe('review-state.json')
    expect(CURATOR_STATE_FILE).toBe('curator-state.json')
    expect(PENDING_STATE_FILE).toBe('pending-state.json')
    expect(PENDING_LEGACY_FILE).toBe('pending.json')
    expect(PENDING_ARCHIVE_FILE).toBe('pending-state-archive.json')
    expect(PENDING_ARCHIVE_BAK_FILE).toBe('pending-state-archive.json.bak')
    expect(PROVIDER_JSON).toBe('json')
    expect(PROVIDER_DOMAIN).toBe('domain')
    expect(REVIEW_STATE_TABLE).toBe('review_state')
    expect(CURATOR_STATE_TABLE).toBe('curator_state')
    expect(PENDING_TABLE).toBe('pending')
  })
})
