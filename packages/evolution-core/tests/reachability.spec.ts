// @tier pre-tag
/** G3/3.4: the read-only reconciliation. These cases pin the three formulas, and - the part that decides
 * whether the numbers can match the audit at all - the reports rule that a record WITHOUT a resultRef
 * still owns the conventional reports/maintain-<id>.json path. */
import { expect, it } from 'vitest'
import { fakeIo } from '../../test-support/fake-io.ts'
import { historyReachability, reportsReachability, backupsReachability } from '../src/reachability.ts'

it('G3/3.4: history counts blobs the indexes no longer reference as unreachable', async () => {
  const io = fakeIo()
  await io.writeText('/h/blobs/' + 'a'.repeat(64), 'A')
  await io.writeText('/h/blobs/' + 'b'.repeat(64), 'B')
  await io.writeText('/h/skills/x/index.json', JSON.stringify({ versions: [{ sha256: 'a'.repeat(64) }] }))
  const reading = await historyReachability(io, '/h')
  expect(reading.total).toBe(2)
  expect(reading.reachable).toBe(1)
  expect(reading.unreachable).toBe(1)
  expect(reading.baseline).toContain('75.4%')
})

it('G3/3.4: reports treats the conventional maintain-<id>.json path as reachable', async () => {
  const io = fakeIo()
  await io.writeText('/home/reports/maintain-1.json', '{}')
  await io.writeText('/home/reports/maintain-2.json', '{}')
  await io.writeText('/home/reports/orphan.md', 'old')
  const reading = await reportsReachability(io, '/home/reports', ['1'], [])
  expect(reading.total).toBe(3)
  expect(reading.reachable).toBe(1)
  expect(reading.unreachable).toBe(2)
})

it('G3/3.4: backups counts a snapshot whose manifest lists no skill as an empty tree', async () => {
  const io = fakeIo()
  await io.writeText('/s/.backups/s1/manifest.json', '{}')
  await io.writeText('/s/.backups/s2/manifest.json', '{}')
  const reading = await backupsReachability(io, '/s/.backups', [0, 3])
  expect(reading.total).toBe(2)
  expect(reading.unreachable).toBe(1)
})
