/**
 * The round-2 JSON envelope a child writes after authoring: which files the merge left
 * behind. Both authoring paths (same-child scan round2 and the new-child approve/resume
 * path) parse it identically, so a declared-but-missing file fails the same way on both.
 */
export interface AuthoringManifest {
  readonly target?: string
  readonly files: readonly string[]
}

function asManifest(value: unknown): AuthoringManifest | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as { target?: unknown; files?: unknown }
  if (!Array.isArray(record.files) || record.files.some(file => typeof file !== 'string')) return null
  if (record.target !== undefined && typeof record.target !== 'string') return null
  return { ...(typeof record.target === 'string' ? { target: record.target } : {}), files: record.files as string[] }
}

/** Every balanced object literal in a prose/fenced answer (string-aware). */
function balancedObjects(text: string): string[] {
  const found: string[] = []
  let depth = 0
  let start = -1
  let quoted = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === '{') { if (depth === 0) start = index; depth += 1; continue }
    if (char !== '}' || depth === 0) continue
    depth -= 1
    if (depth === 0 && start >= 0) { found.push(text.slice(start, index + 1)); start = -1 }
  }
  return found
}

/**
 * Parse the authoring manifest from a child's final turn.
 *
 * P2-20: a child that wraps the envelope in a fenced code block or in one prose
 * sentence is the normal shape, not a malformed answer. A strict whole-text
 * JSON.parse returned null there, and null used to mean "every staged file was
 * declared" - the exact files the check exists to catch. Try the whole answer,
 * then every fenced body, then every balanced object literal.
 * @param text - the child's answer.
 * @returns the first valid envelope, or null when the turn really declared none.
 */
export function parseAuthoringManifest(text: string): AuthoringManifest | null {
  // Author callbacks in tests (and a bare void answer) can hand undefined;
  // "no answer" is the same as "no envelope", not a crash.
  if (typeof text !== 'string') return null
  try {
    const direct = asManifest(JSON.parse(text) as unknown)
    if (direct !== null) return direct
  } catch { /* not the whole answer */ }
  for (const match of text.matchAll(/\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60/g)) {
    try {
      const parsed = asManifest(JSON.parse(match[1] ?? '') as unknown)
      if (parsed !== null) return parsed
    } catch { /* try the next fence/object */ }
  }
  for (const candidate of balancedObjects(text)) {
    try {
      const parsed = asManifest(JSON.parse(candidate) as unknown)
      if (parsed !== null) return parsed
    } catch { /* try the next candidate */ }
  }
  return null
}

/** Files a manifest promises for a staged tree. */
export function manifestFilesOf(manifest: AuthoringManifest | null, stagedPaths: readonly string[]): readonly string[] {
  // P2-20: an answer that declared nothing is NOT a declaration of every staged
  // file. Only SKILL.md is inherently required; any other staged file must be
  // named (or be an existing target support file) or q09-undeclared blocks it.
  if (manifest !== null) return manifest.files
  void stagedPaths
  return ['SKILL.md']
}


/**
 * The first file the manifest promises but the staged tree does not contain.
 * SKILL.md itself is always required, whether or not the manifest lists it.
 * @param files - manifest files (see {@link manifestFilesOf}).
 * @param stagedPaths - support-file paths actually present in the staged tree.
 * @returns the missing path, or null when the declaration is satisfied.
 */
export function missingManifestFile(files: readonly string[], stagedPaths: readonly string[]): string | null {
  if (!files.includes('SKILL.md')) return 'SKILL.md'
  for (const path of files) {
    if (path === 'SKILL.md') continue
    if (!stagedPaths.includes(path)) return path
  }
  return null
}
