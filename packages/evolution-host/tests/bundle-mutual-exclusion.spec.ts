import { describe, expect, it } from 'vitest'
import { loadOverlayPatches, composeEntries } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { cordisRows, rowId, type CordisRow } from '../../test-support/cordis-rows.ts'

// S7.2 / E-33: `dsh-evolution-host` and `dsh-evolution-preset` are two INDEPENDENT
// bundle patches that overlap on the shared infra rows (policy/io/state/memory/
// review/curator/...) but are ALTERNATIVE install layouts — host-only
// (infrastructure, no model tools) vs one-click preset (infrastructure + model
// tools). Installing both would double-mount the infra rows and, if the shared
// configs ever diverge, produce an ambiguous composition. This spec pins the
// mutual exclusion: every row id present in BOTH bundles must carry a
// byte-identical (id/name/config/disabled) definition, and the preset bundle
// keeps the model-facing rows the host must never grow (their distinguishing
// identities). V10-14 (P1-2): the `tool-skill` 60-char catalog cap override
// became a SHARED row (identical in both patches), so the host row set is a
// subset of the preset's — distinctness is pinned via the model tools, not via
// a host-only row.
// V10-14→0.3.54 (route B): `dsh-evolution-all` joins the matrix as the FULL
// bundle — infra ∪ the four model rows. The guards below pin all.patch's row
// bodies to host.patch (infra) and preset.patch (model rows), and the
// composition check proves that mounting all + host (or all + preset) composes
// DUPLICATE infra rows — the precondition for the startup fail-loud (upstream
// invariants globals: a second instance throws already registered).
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
const allPatch = rowMap(
  loadOverlayPatches('test', fileURLToPath(new URL('../../evolution-all/cordis.patch.yml', import.meta.url))),
)

const sharedIds = [...hostPatch.keys()].filter(id => presetPatch.has(id))
const MODEL_TOOLS = ['tool-memory', 'tool-skill-manage', 'tool-session-query', 'evolution-skill-catalog']

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

  it('keeps the preset the only bundle exposing model-facing tools (V10-14: host rows are a subset)', () => {
    const presetOnly = [...presetPatch.keys()].filter(id => !hostPatch.has(id))
    // The preset bundle is the one that exposes the model-facing tools.
    for (const tool of ['tool-memory', 'tool-skill-manage', 'tool-session-query']) {
      expect(presetOnly).toContain(tool)
    }
    // V10-14 (P1-2): the tool-skill cap override is now carried by BOTH
    // bundles, so the host plane is a strict subset of the preset's — pin that
    // subset relationship instead of a host-only row.
    expect(hostPatch.size).toBeGreaterThan(0)
    for (const id of hostPatch.keys()) expect(presetPatch.has(id)).toBe(true)
  })
})

describe('0.3.54: dsh-evolution-all full bundle (route B)', () => {
  it('G-A: every all.patch infra row is byte-identical to host.patch', () => {
    for (const id of hostPatch.keys()) {
      expect(normalize(allPatch.get(id)), `all infra row ${id}`).toEqual(normalize(hostPatch.get(id)))
    }
  })

  it('G-B: the four all.patch model rows are byte-identical to preset.patch', () => {
    for (const id of MODEL_TOOLS) {
      expect(normalize(allPatch.get(id)), `all model row ${id}`).toEqual(normalize(presetPatch.get(id)))
    }
  })

  it('all row set = host infra ∪ 4 model rows and nothing else', () => {
    expect(allPatch.size).toBe(hostPatch.size + MODEL_TOOLS.length)
    for (const id of MODEL_TOOLS) expect(hostPatch.has(id)).toBe(false)
    for (const id of hostPatch.keys()) expect(allPatch.has(id)).toBe(true)
  })

  it('T2: mounting all + host composes DUPLICATE infra rows (the startup fail-loud precondition)', () => {
    const merged = cordisRows(composeEntries([
      loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))),
      loadOverlayPatches('test', fileURLToPath(new URL('../../evolution-all/cordis.patch.yml', import.meta.url))),
    ]))
    const ids = merged.map(rowId).filter(id => id !== '')
    // INSERT rows only: the two root-level config OVERRIDES (session-query-
    // sqlite, tool-skill) patch an existing base row and are not duplicated —
    // composition checks must not count them as double mounts.
    const infraInsertIds = [...hostPatch.keys()].filter(id => id !== 'session-query-sqlite' && id !== 'tool-skill')
    for (const id of infraInsertIds) {
      expect(ids.filter(match => match === id), `infra row ${id} must mount TWICE`).toHaveLength(2)
    }
    // The model rows all added mount exactly once.
    expect(ids.filter(id => id === 'tool-memory')).toHaveLength(1)
  })

  it('T2: mounting all + one-click preset composes DUPLICATE infra rows AND model rows', () => {
    const merged = cordisRows(composeEntries([
      loadOverlayPatches('test', fileURLToPath(new URL('../../evolution-preset/cordis.patch.yml', import.meta.url))),
      loadOverlayPatches('test', fileURLToPath(new URL('../../evolution-all/cordis.patch.yml', import.meta.url))),
    ]))
    const ids = merged.map(rowId).filter(id => id !== '')
    const infraInsertIds = [...hostPatch.keys()].filter(id => id !== 'session-query-sqlite' && id !== 'tool-skill')
    for (const id of infraInsertIds) {
      expect(ids.filter(match => match === id), `infra row ${id} must mount TWICE`).toHaveLength(2)
    }
    // The preset row set already exposes the model tools — all adds a second
    // copy of each, hence the cross-bundle exclusion.
    expect(ids.filter(id => id === 'tool-memory')).toHaveLength(2)
    expect(ids.filter(id => id === 'tool-skill-manage')).toHaveLength(2)
  })
})
