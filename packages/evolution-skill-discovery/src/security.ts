/** One sanitized untrusted string. */
export interface SanitizedText {
  readonly text: string
  readonly truncated: boolean
}

/**
 * Treat description text as data: strip control characters, escape HTML
 * delimiters, and cap length. It never turns data into instructions.
 * @param value - untrusted domain/skill text.
 * @param limit - maximum characters retained.
 * @returns escaped text plus truncation flag.
 */
export function sanitizeUntrustedText(value: string, limit = 2000): SanitizedText {
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  const escaped = cleaned.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return escaped.length <= limit ? { text: escaped, truncated: false } : { text: escaped.slice(0, limit), truncated: true }
}
