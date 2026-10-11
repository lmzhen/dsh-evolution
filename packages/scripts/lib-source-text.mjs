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
 * @param text - the source text to read.
 * @returns the same text with its comments removed.
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
      index = end < 0 ? text.length : end + 1
      continue
    }
    out += char
  }
  return out
}
