// @tier pre-tag
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { migrateV2ToV3 } from '../../src/domain/migrate-v3.ts'

const fixture = fileURLToPath(new URL('../fixtures/0.30.15/generated/merge/merge-state.json', import.meta.url))

it('maps every real 0.30.15 row and rejects unmappable rows', async () => {
  const v2 = JSON.parse(await readFile(fixture, 'utf8')) as { rows: { id: string; state: string }[] }
  const mapped = migrateV2ToV3(v2)
  expect(mapped.ok).toBe(true)
  if (!mapped.ok) return
  expect(mapped.state.rows.map(row => [row.id, row.state])).toEqual(v2.rows.map(row => [row.id, row.state]))
  for (const row of mapped.state.rows) {
    expect(['agent', 'human', 'system']).toContain(row.origin)
    if (row.state === 'fuse') expect(['present', 'absent', 'expired']).toContain(row.staging.kind)
  }
  const quarantined = migrateV2ToV3({ schemaVersion: 2, rows: [v2.rows[0], { id: 'bad' }] })
  expect(quarantined.ok).toBe(true)
  if (quarantined.ok) {
    expect(quarantined.state.rows).toHaveLength(1)
    expect(quarantined.quarantine).toHaveLength(1)
    expect(quarantined.quarantine[0]?.reason).toContain('identity')
  }
})
