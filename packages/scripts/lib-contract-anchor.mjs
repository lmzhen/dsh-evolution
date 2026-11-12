/**
 * Contract-anchor grading (W9-g3-b, audit 05-P1.2).
 *
 * The family's platform contract used to be a TEXT probe: each anchor recorded a string the upstream
 * file had to contain, so a reformat or a comment reflow read as "the platform moved" while a symbol
 * that purely disappeared from a context the text still matched read as "still there". An anchor is
 * graded by what it names:
 *
 *   - `symbol`: the identifier the anchor names is DECLARED in the file (export, member, field, type);
 *   - `text`:  the anchor is a literal (an event name, a slot name) and only text can carry it;
 *   - `missing`: neither holds — the platform moved.
 * @module @deepseek-ai/dsh-evolution-scripts/lib-contract-anchor
 */

const KEYWORD = /(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/
const MEMBER = /(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(]/
const ESCAPE = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The identifier an anchor's text names, if any.
 * @param anchorText - the recorded anchor excerpt.
 * @returns the identifier, or null for a pure literal (an event/slot string).
 */
export function anchorSymbol(anchorText) {
  const keyword = KEYWORD.exec(anchorText)
  if (keyword !== null) return keyword[1]
  const member = MEMBER.exec(anchorText)
  return member === null ? null : member[1]
}

/**
 * Whether `name` is DECLARED in `source` in any shape the platform may use (export, member, field,
 * namespace assignment, record key). Declaration is the signal; formatting and comments are not.
 * @param source - the upstream file text.
 * @param name - the identifier.
 * @returns whether a declaration of that name exists.
 */
export function declaresSymbol(source, name) {
  const escaped = ESCAPE(name)
  const patterns = [
    new RegExp('(?:^|\\n)\\s*(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:class|function|const|let|var|interface|type|enum)\\s+' + escaped + '\\b'),
    new RegExp('\\.\\s*' + escaped + '\\b\\s*[=:]'),
    new RegExp('(?:^|\\n)\\s*(?:readonly\\s+|static\\s+|async\\s+|get\\s+|set\\s+)*' + escaped + '\\s*[?!(<]'),
    new RegExp('(?:^|\\n)\\s*(?:readonly\\s+)?' + escaped + '\\??\\s*:'),
    new RegExp("'" + escaped + "'\\s*:"),
  ]
  return patterns.some((pattern) => pattern.test(source))
}

/**
 * Grade one anchor against the upstream file's text.
 * @param source - the upstream file.
 * @param anchor - the recorded anchor (optionally carrying `kind: 'text'` / an explicit `symbol`).
 * @returns the grade plus the identifier when one was derived.
 */
export function gradeAnchor(source, anchor) {
  const literal = typeof anchor.anchor === 'string' ? anchor.anchor : ''
  if (anchor.kind === 'text') {
    return source.includes(literal) ? { grade: 'text' } : { grade: 'missing', symbol: null }
  }
  const symbol = typeof anchor.symbol === 'string' ? anchor.symbol : anchorSymbol(literal)
  if (symbol === null) {
    return source.includes(literal) ? { grade: 'text' } : { grade: 'missing', symbol: null }
  }
  if (declaresSymbol(source, symbol)) return { grade: 'symbol', symbol }
  // The declaration moved but the exact recorded text is still there: report text-grade rather than
  // silently passing, so the anchor gets re-recorded deliberately.
  if (source.includes(literal)) return { grade: 'text', symbol }
  return { grade: 'missing', symbol }
}
