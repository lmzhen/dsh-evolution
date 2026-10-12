/**
 * Source-text readers shared by the family's gates.
 *
 * Gates that judge CODE must not judge prose: a rule satisfied (or defeated) by a comment is the
 * class the 0.21.0 review found in `verify-param-channel-parity` (a probe reading the whole
 * file could be satisfied by a comment). Every probe that greps source strips comments first.
 *
 * The scanner is string-aware on purpose: an apostrophe inside a comment (platform's) would
 * otherwise read as an unterminated quote and unbalance any brace walk the caller does afterwards.
 *
 * @module lib-source-text
 */

/**
 * Drop line and block comments while skipping quoted strings.
 *
 * G7-3: comment text becomes BLANKS on the same line and every newline survives, so a caller that
 * reports `stripComments(text)` line numbers reports the SOURCE line. (The first version deleted
 * block comments outright, which collapsed their lines and silently shifted every later line.)
 * @param text - the source text to read.
 * @returns the same text with its comments blanked out.
 */
export function stripComments(text) {
  let out = ''
  let quote = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== '') {
      out += char
      if (char === quote && text[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      out += char
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      out += '\n'
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      const stop = end < 0 ? text.length : end + 2
      // Blank the comment in place: newlines stay, so line numbers do not move.
      for (let at = index; at < stop; at += 1) out += text[at] === '\n' ? '\n' : ' '
      index = stop - 1
      continue
    }
    out += char
  }
  return out
}
