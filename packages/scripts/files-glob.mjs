/**
 * npm files-list matching for the dependency-closure guard.
 *
 * P2-38: the previous matcher treated every star as "any characters, including
 * a slash". That made the double-star pattern miss a top-level file (double
 * star must match zero directories) and made the single-star pattern accept
 * nested files. This is the documented npm/minimatch shape: one star stays
 * within one segment, double star spans zero or more segments.
 */

function escapeSegment(segment) {
  return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
}

function matchesPattern(pattern, parts, pi = 0, ri = 0) {
  if (pi === pattern.length) return ri === parts.length
  if (pattern[pi] === '**') {
    if (matchesPattern(pattern, parts, pi + 1, ri)) return true
    return ri < parts.length && matchesPattern(pattern, parts, pi, ri + 1)
  }
  if (ri >= parts.length) return false
  if (!new RegExp('^' + escapeSegment(pattern[pi]) + '$').test(parts[ri])) return false
  return matchesPattern(pattern, parts, pi + 1, ri + 1)
}

/**
 * Does one manifest files list ship a package-relative path?
 * @param list - the manifest's files array.
 * @param rel - package-relative path, slash-separated.
 * @returns whether npm would include the path.
 */
export function coveredByFiles(list, rel) {
  if (!Array.isArray(list)) return false
  const subject = String(rel).replace(/\\/g, '/').replace(/^\.\//, '')
  for (const raw of list) {
    let pattern = String(raw).replace(/\\/g, '/')
    if (pattern.startsWith('./')) pattern = pattern.slice(2)
    if (pattern.endsWith('/')) pattern = pattern.slice(0, -1)
    if (pattern === subject || subject.startsWith(pattern + '/')) return true
    if (!pattern.includes('*')) continue
    if (matchesPattern(pattern.split('/'), subject.split('/'))) return true
  }
  return false
}
