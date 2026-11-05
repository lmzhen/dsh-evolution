/** Pure reading shape for one skill's versions; no loading and no store. */
import type { VersionRow, VersionsPayload } from './api.ts'

/** The content chain split for display: current body first, older versions as a timeline. */
export interface HistoryViewModel {
  readonly current: readonly VersionRow[]
  readonly older: readonly VersionRow[]
  readonly support: readonly VersionRow[]
  readonly hasAny: boolean
}

/**
 * Split a version payload without inventing a version. The host marks current rows with
 * `undoable: false`; if an older payload lacks that marker, the first content row is the current one.
 * @param payload - content and support chains from the host.
 * @returns the display model.
 */
export function historyViewModel(payload: VersionsPayload): HistoryViewModel {
  const marked = payload.content.filter(row => row.undoable === false)
  const current = marked.length > 0 ? marked : payload.content.slice(0, 1)
  const currentVersions = new Set(current.map(row => row.v))
  const older = payload.content.filter(row => !currentVersions.has(row.v))
  return { current, older, support: payload.support, hasAny: payload.content.length > 0 || payload.support.length > 0 }
}
