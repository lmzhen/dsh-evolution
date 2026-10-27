/**
 * The round-2 JSON envelope a child writes after authoring: which files the merge left
 * behind. Both authoring paths (same-child scan round2 and the new-child approve/resume
 * path) parse it identically, so a declared-but-missing file fails the same way on both.
 */
export interface AuthoringManifest {
  readonly target?: string
  readonly files: readonly string[]
}

/**
 * Parse `{"target":..., "files":[...]}` from a child's final turn text.
 * @param text - the child's answer (JSON is expected; prose is tolerated).
 * @returns the manifest, or null when the turn carried no well-formed envelope.
 */
export function parseAuthoringManifest(text: string): AuthoringManifest | null {
  try {
    const value = JSON.parse(text) as { target?: unknown; files?: unknown }
    if (!Array.isArray(value.files) || value.files.some(file => typeof file !== 'string')) return null
    if (value.target !== undefined && typeof value.target !== 'string') return null
    return { ...(typeof value.target === 'string' ? { target: value.target } : {}), files: value.files as string[] }
  } catch { return null }
}

/** Files a manifest promises for a staged tree (declared list, or the tree when undeclared). */
export function manifestFilesOf(manifest: AuthoringManifest | null, stagedPaths: readonly string[]): readonly string[] {
  if (manifest !== null) return manifest.files
  return ['SKILL.md', ...stagedPaths]
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