import { h2Sections } from './document-body.ts'

const LF = String.fromCharCode(10)

/** One section/block selection request. Heading is exact; start/end select a content sub-block. */
export interface SectionSelectionRequest {
  heading: string
  start?: string
  end?: string
}

/** One selected range. Whole-H2 selections omit anchorStart/anchorEnd. */
export interface SelectedSection {
  heading: string
  start: number
  end: number
  text: string
  requestIndex: number
  anchorStart?: string
  anchorEnd?: string
}

/** Selection result; failure messages preserve the restructure planner's wording. */
export type SectionSelectionResult =
  | { ok: true; sections: SelectedSection[] }
  | { ok: false; code: string; message: string }

/**
 * Select whole H2 sections or exact content sub-blocks from one body.
 *
 * The H2 scan is document-body's h2Sections, so restructure and extract share
 * one boundary rule. A start/end pair selects an inclusive, contiguous run of
 * exact lines inside that heading; it cannot select the heading itself, overlap
 * another request, or leave a selected range empty.
 * @param body - markdown after frontmatter.
 * @param requests - exact heading plus optional start/end line pairs.
 * @returns selected ranges in request order, or the first refusal.
 */
export function selectSections(body: string, requests: readonly SectionSelectionRequest[]): SectionSelectionResult {
  const lines = body.split(LF)
  const sections = h2Sections(body)
  const selected: SelectedSection[] = []
  for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
    const request = requests[requestIndex]
    if (request === undefined) continue
    const wanted = request.heading.trim()
    const matching = sections.filter(section => section.title === wanted)
    if (matching.length === 0) return { ok: false, code: 'heading-missing', message: 'no "## ' + wanted + '" heading in the body' }
    if (matching.length > 1) return { ok: false, code: 'heading-ambiguous', message: 'heading "## ' + wanted + '" appears ' + matching.length + ' times (ambiguous anchor)' }
    const section = matching[0]
    if (section === undefined) return { ok: false, code: 'heading-missing', message: 'no "## ' + wanted + '" heading in the body' }
    if (selected.some(entry => entry.start === section.start)) {
      return { ok: false, code: 'heading-duplicate', message: 'heading "## ' + wanted + '" is moved twice' }
    }
    const partial = request.start !== undefined || request.end !== undefined
    if (!partial) {
      if (section.end === section.start + 1) return { ok: false, code: 'heading-empty', message: 'heading "## ' + wanted + '" has an empty section' }
      selected.push({ heading: wanted, start: section.start, end: section.end, text: lines.slice(section.start, section.end).join(LF), requestIndex })
      continue
    }
    if (request.start === undefined || request.end === undefined) {
      return { ok: false, code: 'part-anchor-incomplete', message: 'heading "## ' + wanted + '" needs both start and end anchors' }
    }
    const startMatches: number[] = []
    const endMatches: number[] = []
    for (let index = 0; index < lines.length; index += 1) {
      if (index <= section.start || index >= section.end) continue
      if (lines[index] === request.start) startMatches.push(index)
      if (lines[index] === request.end) endMatches.push(index)
    }
    if (startMatches.length !== 1) return { ok: false, code: 'part-anchor-not-found', message: 'heading "## ' + wanted + '" start anchor must match exactly one content line' }
    if (endMatches.length !== 1) return { ok: false, code: 'part-anchor-not-found', message: 'heading "## ' + wanted + '" end anchor must match exactly one content line' }
    const start = startMatches[0]
    const end = endMatches[0]
    if (start === undefined || end === undefined || start > end) {
      return { ok: false, code: 'part-anchor-order', message: 'heading "## ' + wanted + '" start anchor is after end anchor' }
    }
    if (selected.some(entry => start < entry.end && end + 1 > entry.start)) {
      return { ok: false, code: 'part-anchor-overlaps', message: 'heading "## ' + wanted + '" selection overlaps another selected block' }
    }
    selected.push({
      heading: wanted,
      start,
      end: end + 1,
      text: lines.slice(start, end + 1).join(LF),
      requestIndex,
      anchorStart: request.start,
      anchorEnd: request.end,
    })
  }
  return { ok: true, sections: selected }
}
