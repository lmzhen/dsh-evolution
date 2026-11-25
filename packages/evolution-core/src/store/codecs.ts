/**
 * Typed codecs for domains that production code reads/writes directly.
 *
 * Add one codec next to its domain rather than another file-shaped adapter:
 * `StoreService.read/transact` take the codec and keep decode failures loud.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/codecs
 */
import type { DomainCodec } from './service.ts'
import { StoreCorruptError } from './types.ts'

/** The reports domain is a map of home-relative path -> text. */
export const reportsCodec: DomainCodec<Record<string, string>> = {
  decode(value) {
    if (value === undefined) return {}
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new StoreCorruptError('reports domain is not a path->text object')
    }
    const reports: Record<string, string> = {}
    for (const [key, text] of Object.entries(value)) {
      if (typeof text !== 'string') throw new StoreCorruptError('reports domain entry ' + key + ' is not text')
      reports[key] = text
    }
    return reports
  },
  encode(value) {
    return value
  },
}
