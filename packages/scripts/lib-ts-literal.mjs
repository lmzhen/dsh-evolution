#!/usr/bin/env node
/**
 * Render plain data as a TypeScript literal that the repo's lint accepts (single quotes, trailing
 * commas in every multi-line object/array). Generators used `JSON.stringify` before, so every
 * generated artifact failed oxlint `quotes`/`comma-dangle` and the tag run went red in lint — the
 * generated files must be lint-clean by construction, not fixed by hand.
 */

/** Render one string as a single-quoted TypeScript literal. */
export function tsString(value) {
  return "'" + String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'"
}

/**
 * Render plain JSON-safe data as TypeScript source.
 * @param value - data to render.
 * @param depth - indentation depth (2 spaces per level; omit at the top level).
 * @returns TypeScript literal text (strings single-quoted, multi-line collections trailing-comma).
 */
export function tsLiteral(value, depth = 0) {
  const pad = '  '.repeat(depth)
  const padIn = '  '.repeat(depth + 1)
  if (typeof value === 'string') return tsString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return '[\n' + value.map((item) => padIn + tsLiteral(item, depth + 1) + ',\n').join('') + pad + ']'
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  return '{\n' + entries.map(([key, item]) => {
    const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : tsString(key)
    return padIn + name + ': ' + tsLiteral(item, depth + 1) + ',\n'
  }).join('') + pad + '}'
}
