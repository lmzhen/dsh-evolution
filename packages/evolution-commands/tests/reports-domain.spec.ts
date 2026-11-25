// @tier fast
import { describe, expect, it } from 'vitest'
import { pruneMaintainReportsDomain } from '../src/index.ts'

describe('reports domain retention', () => {
  it('keeps the newest 20 maintain pairs and leaves other report prefixes alone', () => {
    const reports: Record<string, string> = { 'reports/merge-other.json': '{"x":1}' }
    for (let i = 1; i <= 22; i += 1) {
      reports['reports/maintain-r' + String(i) + '.json'] = JSON.stringify({ runId: 'r' + String(i), endedAt: i })
      reports['reports/maintain-r' + String(i) + '.md'] = 'body'
    }
    const pruned = pruneMaintainReportsDomain(reports)
    expect(Object.keys(pruned).filter(key => key.startsWith('reports/maintain-')).length).toBe(40)
    expect(pruned['reports/maintain-r1.json']).toBeUndefined()
    expect(pruned['reports/maintain-r1.md']).toBeUndefined()
    expect(pruned['reports/maintain-r3.json']).toBeDefined()
    expect(pruned['reports/maintain-r22.md']).toBeDefined()
    expect(pruned['reports/merge-other.json']).toBe('{"x":1}')
  })
})
