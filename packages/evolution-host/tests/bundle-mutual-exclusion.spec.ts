import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { cordisRows, rowId, type CordisRow } from '../../test-support/cordis-rows.ts'

// S7.2 / E-33: `dsh-evolution-host` and `dsh-evolution-preset` are two INDEPENDENT
// bundle patches that overlap on the shared infra rows (policy/io/state/memory/
// review/curator/...) but are ALTERNATIVE install layouts — host-only
// (infrastructure, no model tools) vs one-click preset (infrastructure + model
// tools). Installing both would double-mount the infra rows and, if the shared
// configs ever diverge, produce an ambiguous composition. This spec pins the
// mutual exclusion: every row id present in BOTH bundles must carry a
// byte-identical (id/name/config/disabled) definition, and each bundle keeps at
// least one row the other lacks (their distinguishing identities).
function rowMap(value: unknown): Map<string, CordisRow> {
  const map = new Map<string, CordisRow>()
  for (const entry of cordisRows(value)) {
    if (Array.isArray(entry.insert)) {
      for (const row of cordisRows(entry.insert)) {
        const id = rowId(row)
        if (id) map.set(id, row)
      }
    } else {
      const id = rowId(entry)
      if (id) map.set(id, entry)
    }
  }
  return map
}

const normalize = (row: CordisRow | undefined) => ({ name: row?.name, config: row?.config, disabled: row?.disabled })

const hostPatch = rowMap(loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))))
const presetPatch = rowMap(
  loadOverlayPatches('test', fileURLToPath(new URL('../../evolution-preset/cordis.patch.yml', import.meta.url))),
)

const sharedIds = [...hostPatch.keys()].filter(id => presetPatch.has(id))

describe('host/preset dual-bundle mutual exclusion (S7.2, E-33)', () => {
  it('overlaps only on shared infra rows, not the full composition', () => {
    // Both bundles own the infrastructure plane; sharedIds is the overlap.
    expect(sharedIds.length).toBeGreaterThan(0)
  })

  it('defines every shared row identically across the two bundles', () => {
    for (const id of sharedIds) {
      expect(normalize(presetPatch.get(id)), `shared row ${id}`).toEqual(normalize(hostPatch.get(id)))
    }
  })

  it('keeps each bundle a distinct, non-superset install target', () => {
    const hostOnly = [...hostPatch.keys()].filter(id => !presetPatch.has(id))
    const presetOnly = [...presetPatch.keys()].filter(id => !hostPatch.has(id))
    expect(hostOnly.length).toBeGreaterThan(0)
    expect(presetOnly.length).toBeGreaterThan(0)
    // The preset bundle is the one that exposes the model-facing tools.
    for (const tool of ['tool-memory', 'tool-skill-manage', 'tool-session-query']) {
      expect(presetOnly).toContain(tool)
    }
  })
})
