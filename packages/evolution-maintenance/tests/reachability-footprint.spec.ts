// @tier pre-tag
/** G3/3.4: the reachability readings folded into the footprint channel. Three states matter here: no io
 * (nothing measurable), io without a skills root (the two rooted domains unmeasurable, reports still
 * attempted), and a full runtime (three measured lines). Wiring this into a run before giving it its own
 * cases is exactly how the previous attempt turned another test red. */
import { expect, it } from 'vitest'
import { fakeIo } from '../../test-support/fake-io.ts'
import { reachabilityFootprint } from '../src/footprint.ts'

it('G3/3.4: with no io every domain is UNKNOWN and says why', async () => {
  const readings = await reachabilityFootprint(undefined, '/skills')
  expect(readings).toHaveLength(3)
  expect(readings.every(reading => reading.skipped !== undefined)).toBe(true)
  expect(readings.map(reading => reading.id)).toEqual(['history.blobs', 'reports.files', 'backups.trees'])
})

it('G3/3.4: without a skills root the two rooted domains are UNKNOWN, reports is still measured', async () => {
  const io = fakeIo()
  const readings = await reachabilityFootprint(io, undefined)
  const byId = new Map(readings.map(reading => [reading.id, reading]))
  expect(byId.get('history.blobs')?.skipped).toBeDefined()
  expect(byId.get('backups.trees')?.skipped).toBeDefined()
  expect(byId.get('reports.files')?.skipped).toBeUndefined()
})

it('G3/3.4: a full runtime yields three measured lines carrying their audit baselines', async () => {
  const io = fakeIo()
  await io.writeText('/skills/.history/blobs/' + 'a'.repeat(64), 'A')
  await io.writeText('/skills/.history/skills/x/index.json', JSON.stringify({ versions: [] }))
  await io.writeText('/skills/.backups/s1/manifest.json', '{}')
  const readings = await reachabilityFootprint(io, '/skills')
  expect(readings).toHaveLength(3)
  expect(readings.every(reading => reading.skipped === undefined)).toBe(true)
  const history = readings.find(reading => reading.id === 'history.blobs')
  expect(history?.used).toBe(1)
  expect(history?.bound).toContain('75.4%')
})
