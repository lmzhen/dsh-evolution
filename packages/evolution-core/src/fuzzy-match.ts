/**
 * Fuzzy string matching and replacement for patch/restructure edits of skill files.
 *
 * Split out of skill-store.ts (S2-1): pure text functions with no store state.
 * The store imports the scan, the budgets and the replace entry points directly;
 * none of them is re-exported, so the package export surface is unchanged.
 */

function fuzzyIndexOf(content: string, pattern: string, from = 0): [number, number] | null {
  const isSpace = (char: string | undefined) => char !== undefined && /[ \t]/.test(char)
  const escaped = (char: string | undefined): string | null => {
    if (char === 'n') return '\n'
    if (char === 't') return '\t'
    if (char === 'r') return '\r'
    return null
  }
  for (let start = from; start < content.length; start += 1) {
    let contentIndex = start
    let patternIndex = 0
    while (patternIndex < pattern.length && contentIndex < content.length) {
      const patternChar = pattern[patternIndex]
      const contentChar = content[contentIndex]
      if (isSpace(patternChar)) {
        // A pattern whitespace run consumes its full run plus any content run
        // (even a shorter or empty one) before matching the next non-space.
        while (patternIndex < pattern.length && isSpace(pattern[patternIndex])) patternIndex += 1
        while (contentIndex < content.length && isSpace(content[contentIndex])) contentIndex += 1
        continue
      }
      const escapedChar = patternChar === '\\' ? escaped(pattern[patternIndex + 1]) : null
      if (escapedChar !== null && contentChar === escapedChar) {
        patternIndex += 2
        contentIndex += 1
        continue
      }
      if (patternChar === contentChar) {
        contentIndex += 1
        patternIndex += 1
        continue
      }
      break
    }
    if (patternIndex === pattern.length) return [start, contentIndex]
  }
  return null
}

/** V6-17 (0.3.37): the fuzzy-patch scan is O(n·m) with no input bound; a
 * non-exact anchor past these budgets would block the event loop (measured
 * ~6s at 20k×20k). Exact matches go through the fast `includes` path and stay
 * allowed regardless of size. */
export const FUZZY_MAX_PATTERN_CHARS = 4096
export const FUZZY_MAX_WORK = 8_000_000

/** Trim leading whitespace of the first line and trailing whitespace of the last line. */
export function trimPatternBoundaries(pattern: string): string {
  const from = pattern.search(/\S/)
  const trimmed = from < 0 ? pattern : pattern.slice(from)
  const trailing = trimmed.search(/\s+$/)
  return trailing < 0 ? trimmed : trimmed.slice(0, trailing)
}

/** Replace only the fuzzy-matched span, preserving all surrounding bytes.
 * V7-11 (0.3.44): the replaceAll loop accumulates the per-scan cost — the
 * single-scan budget at the caller only bounded ONE fuzzyIndexOf, while an
 * unbounded number of matches × O(n·m) each could still stall the loop.
 * When the accumulated cost exceeds the budget the whole replace fails
 * (null) instead of partially applying an arbitrary prefix. */
function fuzzyReplace(content: string, oldString: string, newString: string, replaceAll: boolean): string | null {
  let current = content
  let scanFrom = 0
  let totalWork = 0
  for (;;) {
    totalWork += current.length * oldString.length
    if (totalWork > FUZZY_MAX_WORK) return null
    const match = fuzzyIndexOf(current, oldString, scanFrom)
    if (match === null) return current
    const [start, end] = match
    const next = current.slice(0, start) + newString + current.slice(end)
    if (!replaceAll) return next
    current = next
    // Resume scanning after the inserted span: a self-containing newString must
    // not be re-matched (mirrors String.replaceAll and guarantees termination).
    scanFrom = start + newString.length
  }
}

export function fuzzyPatch(content: string, oldString: string, newString: string, replaceAll = false): string | null {
  // An empty oldString would `includes('')` trivially and splice newString
  // between every character; refuse it at the boundary (P0-5).
  if (oldString === '') return null
  if (content.includes(oldString)) {
    // 0.3.16 (E-2): a STRING replacement expands $&/$`/$'/$$ special
    // sequences even in the exact-match fast path — a model writing a shell
    // replacement (`100$'`) silently corrupted the file, and the fuzzy path
    // (string concat, literal) disagreed with the fast path. The replacement
    // function returns the newString verbatim; the replaceAll branch's
    // split/join is already literal.
    return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, () => newString)
  }
  const boundary = trimPatternBoundaries(oldString)
  // A whitespace-only pattern has no non-whitespace footprint; matching it
  // would hit an empty span and splice content without consuming anything.
  if (boundary === '') return null
  // Stage 1: boundary trim — the model often cites a line with its leading
  // indent (or a trailing space); trimming only the pattern's first/last line
  // keeps the replacement span on the real text without touching other bytes.
  if (boundary !== oldString) {
    if (fuzzyIndexOf(content, boundary) !== null) {
      const patched = fuzzyReplace(content, boundary, newString, replaceAll)
      // F-317: patched === content is an IDENTITY replacement (the effective
      // old/new text are equal), NOT "no match". Return the original so the
      // caller's noop judgment (patch()) reports it as unchanged — returning
      // null here made patch() say "Could not find old_string" for a patch
      // that was actually a no-op. `null` remains exclusively "no match".
      return patched
    }
  }
  // Stage 2: whitespace-plus-escape tolerance (pattern `\n`/`\t`/`\r` literals
  // match real characters, runs match runs); replacement lands on the span
  // only, so file indentation/formatting survives.
  if (fuzzyIndexOf(content, oldString) !== null) {
    const patched = fuzzyReplace(content, oldString, newString, replaceAll)
    return patched
  }
  return null
}

/** Deterministic section-extraction plan facts; the caller owns the IO and the append semantics. */
