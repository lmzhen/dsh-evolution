/**
 * Support-directory references in a markdown body (009 kernel): references/…,
 * templates/…, scripts/…, assets/… relative links — any extension and nested
 * paths. Pure: who checks them and what the verdict is belongs to the caller.
 * `..` traversal is a different defect class (path validation owns it) and is
 * not a support link.
 */
export function supportRefs(content: string): string[] {
  const refs: string[] = []
  for (const match of content.matchAll(/(?<![A-Za-z0-9._/-])(?:references|templates|scripts|assets)\/[A-Za-z0-9._/-]+/g)) {
    const ref = match[0]
    if (ref.includes('..')) continue
    refs.push(ref)
  }
  return refs
}

/**
 * References that leave the skill root: parent traversals or absolute support paths.
 * Extract must not silently treat these as relative support files; the caller reports
 * them (bounded external copy is a separate, explicit policy).
 * @param content - markdown body.
 * @returns external-looking support references, de-duplicated in first-seen order.
 */
export function externalRefs(content: string): string[] {
  const refs: string[] = []
  for (const match of content.matchAll(/(?:^|[\s("'`])((?:\.\.\/)+[A-Za-z0-9._/-]+|\/[A-Za-z0-9._/-]+)/g)) {
    const ref = match[1]?.replace(/[.,;:]+$/, '')
    if (ref === undefined || ref.length === 0 || refs.includes(ref)) continue
    refs.push(ref)
  }
  return refs
}
