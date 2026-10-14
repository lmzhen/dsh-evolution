// @tier fast
// @vitest-environment jsdom
/**
 * U-7 (G5.6) judge ①, the skill-history half: a focus ring that fires on mouse clicks is noise, so
 * every one of these rules must name `:focus-visible`. (The family had it right in this half already —
 * this spec is what keeps it right.)
 */
import { describe, expect, it } from 'vitest'
import { CSS } from '../src/client/styles.ts'

describe('U-7: every focus ring is :focus-visible', () => {
  it('names no bare :focus selector', () => {
    const offenders = CSS.split('\n').filter(line => line.includes(':focus') && !line.includes(':focus-visible'))
    expect(offenders).toEqual([])
  })
})
