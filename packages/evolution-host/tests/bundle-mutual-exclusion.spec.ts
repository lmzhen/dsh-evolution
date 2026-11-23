// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { loadOverlayPatches, composeEntries } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { cordisRows, rowId, type CordisRow } from '../../test-support/cordis-rows.ts'

// V10-14 -> 0.3.54 (route B): `dsh-evolution-all` is the FULL bundle
// (infra + the three model rows). The one-click `dsh-evolution-preset` bundle was
// retired; this spec now pins the remaining all/host relationship:
// - every all.patch infra row is byte-identical to host.patch;
// - all row set = host infra + the model rows + the all-only rows;
// - mounting all + host composes DUPLICATE infra rows (startup fail-loud precondition).
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
const allPatch = rowMap(
  loadOverlayPatches('test', fileURLToPath(new URL('../../evolution-all/cordis.patch.yml', import.meta.url))),
)

const MODEL_TOOLS = ['tool-memory', 'tool-skill-manage', 'evolution-skill-catalog']

/** Rows that are neither host infra nor model-facing: the UI umbrella makes its
 * own host registration but stays out of the host-only bundle; the merge view is
 * a client-only package row for the workbench slot; the health panel ships disabled. */
const ALL_ONLY_ROWS = ['evolution-skill-health', 'evolution-ui', 'evolution-merge-ui']

/** 0.28.0: the merge host row is all-only. */
const ALL_EXTRA_INFRA: string[] = ['evolution-skill-discovery']

describe('0.3.54: dsh-evolution-all full bundle (route B)', () => {
  it('G-A: every all.patch infra row is byte-identical to host.patch', () => {
    for (const id of hostPatch.keys()) {
      expect(normalize(allPatch.get(id)), `all infra row ${id}`).toEqual(normalize(hostPatch.get(id)))
    }
  })

  it('0.60.1: the bundle owns the node:fs IO provider (fresh-home merge state)', () => {
    for (const [label, patch] of [['host', hostPatch], ['all', allPatch]] as const) {
      expect(patch.get('evolution-io-node')?.name, `${label} evolution-io-node`).toBe(
        '@deepseek-ai/dsh-evolution-core/io-node',
      )
    }
  })

  it('all row set = host infra ∪ 3 model rows ∪ the all-only rows', () => {
    expect(allPatch.size).toBe(hostPatch.size + MODEL_TOOLS.length + ALL_ONLY_ROWS.length + ALL_EXTRA_INFRA.length)
    for (const id of ALL_EXTRA_INFRA) expect(hostPatch.has(id), `${id} must stay all-only`).toBe(false)
    for (const id of MODEL_TOOLS) expect(hostPatch.has(id)).toBe(false)
    for (const id of ALL_ONLY_ROWS) expect(hostPatch.has(id), `${id} must stay out of the host bundle`).toBe(false)
    for (const id of hostPatch.keys()) expect(allPatch.has(id)).toBe(true)
  })

  it('T2: mounting all + host composes DUPLICATE infra rows (the startup fail-loud precondition)', () => {
    const merged = cordisRows(composeEntries([
      loadOverlayPatches('test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))),
      loadOverlayPatches('test', fileURLToPath(new URL('../../evolution-all/cordis.patch.yml', import.meta.url))),
    ]))
    const ids = merged.map(rowId).filter(id => id !== '')
    const infraInsertIds = [...hostPatch.keys()]
    for (const id of infraInsertIds) {
      expect(ids.filter(match => match === id), `infra row ${id} must mount TWICE`).toHaveLength(2)
    }
    expect(ids.filter(id => id === 'tool-memory')).toHaveLength(1)
  })
})
