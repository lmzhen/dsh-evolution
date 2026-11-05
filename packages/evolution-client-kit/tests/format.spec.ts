// @tier fast
import { expect, it } from 'vitest'
import { formatLocalDateTime } from '../src/format.ts'

it('formats local wall time with optional seconds and returns null for bad input', () => {
  const value = '2026-10-01T12:00:00.000Z'
  const expected = (seconds: boolean): string => {
    const date = new Date(value)
    const pad = (part: number): string => String(part).padStart(2, '0')
    const head = String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    return seconds ? head + ':' + pad(date.getSeconds()) : head
  }
  expect(formatLocalDateTime(value)).toBe(expected(true))
  expect(formatLocalDateTime(value, { seconds: false })).toBe(expected(false))
  expect(formatLocalDateTime(null)).toBeNull()
  expect(formatLocalDateTime('not-a-date')).toBeNull()
})
