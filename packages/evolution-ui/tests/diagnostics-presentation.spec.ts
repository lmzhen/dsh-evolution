// @tier fast
import { expect, it } from 'vitest'
import { diagnosticsReading } from '../src/panels/settings/DiagnosticsCard.ts'
import type { DiagnosticRow } from '@lmzhen/dsh-evolution-client-kit/generated/contracts'

const row = (key: string, status: DiagnosticRow['status']): DiagnosticRow => ({ key, label: key, status })

it('keeps the highest issue first, preserves the rest, and folds normal checks', () => {
  const reading = diagnosticsReading([row('ok', 'ok'), row('warn', 'warn'), row('fail', 'fail')])
  expect(reading.topIssue?.key).toBe('fail')
  expect(reading.otherIssues.map(item => item.key)).toEqual(['warn'])
  expect(reading.normal.map(item => item.key)).toEqual(['ok'])
})

it('has no top issue when everything is normal', () => {
  const reading = diagnosticsReading([row('ok-a', 'ok'), row('ok-b', 'ok')])
  expect(reading.topIssue).toBeUndefined()
  expect(reading.normal).toHaveLength(2)
})
