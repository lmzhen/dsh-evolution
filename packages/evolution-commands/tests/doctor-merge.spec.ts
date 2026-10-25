// @tier ci-only
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { diagnose, renderDoctorText } from '../src/doctor.ts'

const home = async (prefix: string): Promise<string> => await mkdtemp(join(tmpdir(), prefix))

it('renders the merge plugin doctorFact as a merge line and a next step', async () => {
  const ctx = {
    get: (name: string): unknown => name === 'evolutionMerge'
      ? { async doctorFact() { return { status: 'warn', detail: 'verify 1 / pending 2 / fuse 0 / skipped 0 / expired 1；staging ok', remedy: '运行 /evolution merge reconcile 收敛' } } }
      : undefined,
  }
  const report = await diagnose(ctx, { home: await home('doctor-merge-warn-') })
  expect(report.merge.status).toBe('warn')
  expect(report.merge.detail).toContain('verify 1')
  expect(report.actions.some(action => action.includes('合并行'))).toBe(true)
  const text = renderDoctorText(report)
  expect(text).toContain('merge: [注意] verify 1')
  expect(text).toContain('/evolution merge reconcile')
})

it('keeps a merge line when the merge service is not mounted', async () => {
  const report = await diagnose({ get: () => undefined }, { home: await home('doctor-merge-absent-') })
  expect(report.merge.status).toBe('unknown')
  expect(report.merge.detail).toContain('evolutionMerge 服务未挂载')
  expect(renderDoctorText(report)).toContain('merge: [未知]')
})

it('turns a throwing merge probe into an unknown row instead of failing doctor', async () => {
  const ctx = { get: (name: string): unknown => name === 'evolutionMerge' ? { async doctorFact(): Promise<unknown> { throw new Error('boom') } } : undefined }
  const report = await diagnose(ctx, { home: await home('doctor-merge-throw-') })
  expect(report.merge.status).toBe('unknown')
  expect(report.merge.detail).toContain('合并状态探测失败')
})
