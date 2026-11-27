// @tier fast
import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HomeFence, StoreKernel, createStoreService, mergeIoIfV2, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { writeMergeReport } from '../src/report.ts'

it('writes a merge report through reports.rw on an active v2 home', async () => {
  const home = await tempRoot('dsh-merge-report-surface-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'state'), { recursive: true })
  await writeFile(join(home, 'state', '.migrated-to-store-v2.json'), '{}\n')
  const fence = new HomeFence({ home })
  const kernel = new StoreKernel({ io, home, fence })
  await kernel.bootstrap({ merge: { text: '' }, mergeMeta: {}, reports: {} })
  const service = createStoreService(kernel)
  const bridge = mergeIoIfV2(undefined, io, home, fence, service)
  expect(bridge).not.toBeUndefined()
  const report = {
    schemaVersion: 2 as const,
    kind: 'merge' as const,
    runId: 'run-report-surface',
    command: 'scan' as const,
    startedAt: 1,
    endedAt: 2,
    stopReason: 'completed' as const,
    scope: { candidatePairs: 0, queueBefore: { verify: 0, pending: 0, fuse: 0, skipped: 0 } },
    pairs: [],
    totals: { merged: 0, kept: 0, pending: 0, failed: 0 },
    notes: [] as string[],
  }
  const path = await writeMergeReport(bridge!, home, report)
  expect(path).toBe(join(home, 'reports', 'merge-run-report-surface.json'))
  expect(await bridge!.readText(path)).toContain('"runId": "run-report-surface"')
  const domains = (await service.query('reports.rw', ['reports'])).snapshot.domains.reports as Record<string, string>
  expect(domains['reports/merge-run-report-surface.json']).toContain('"runId": "run-report-surface"')
  expect(domains['reports/merge-run-report-surface.md']).toContain('# merge run-report-surface')
})
