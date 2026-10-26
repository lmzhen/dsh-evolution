// @tier pre-tag
import { expect, it } from 'vitest'
import { commandError, formatMergeError } from '../src/domain/errors.ts'

it('redacts common credential shapes from the three-line diagnostic', () => {
  const text = formatMergeError(commandError('pair', 'merge-failed', 'sk-abcdefghijklmnop ghp_abcdefghijklmnopqrst token=secret123 password: hunter2 AKIAABCDEFGHIJKLMNOP', 'next'))
  expect(text).not.toContain('sk-abcdefghijklmnop')
  expect(text).not.toContain('ghp_abcdefghijklmnopqrst')
  expect(text).not.toContain('secret123')
  expect(text).not.toContain('hunter2')
  expect(text).not.toContain('AKIAABCDEFGHIJKLMNOP')
  expect(text).toContain('[redacted]')
})

it('keeps the code/hint/next three-line shape after redaction', () => {
  const text = formatMergeError(commandError('pair', 'merge-failed', 'Bearer abc', 'rerun'))
  expect(text.split('\n')).toHaveLength(3)
  expect(text).toContain('code: merge-failed')
  expect(text).toContain('hint: Bearer [redacted]')
  expect(text).toContain('next: rerun')
})
