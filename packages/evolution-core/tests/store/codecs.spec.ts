// @tier fast
import { describe, expect, it } from 'vitest'
import { reportsCodec } from '../../src/store/codecs.ts'
import { StoreCorruptError } from '../../src/store/types.ts'

describe('reports codec', () => {
  it('decodes a path->text map and fails closed on another shape', () => {
    expect(reportsCodec.decode(undefined)).toEqual({})
    expect(reportsCodec.decode({ 'reports/a.json': '{}' })).toEqual({ 'reports/a.json': '{}' })
    expect(() => reportsCodec.decode({ 'reports/a.json': 1 })).toThrow(StoreCorruptError)
    expect(() => reportsCodec.decode([])).toThrow(StoreCorruptError)
    expect(reportsCodec.encode({ 'reports/a.json': '{}' })).toEqual({ 'reports/a.json': '{}' })
  })
})
