/**
 * Enrichment maps shared by the full maintain scan and the `--facts` preview
 * (v12) AND the maintenance_probe tool (0.3.9): one construction = the probe
 * and the facts block can never disagree about descriptions, support files,
 * or quality (the 0.3.8 review found the probe answering "description=missing"
 * while the facts block measured real lengths — probe snapshots carried no
 * enrichment at all).
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  frontmatterCatalogInvalid,
  isPresent,
  parseFrontmatter,
  usageObserved,
  type SkillLibrary,
  type UsageMap,
} from '@deepseek-ai/dsh-evolution-core'

export interface Enrichment {
  descriptions: ReadonlyMap<string, string>
  supportFiles: ReadonlyMap<string, readonly string[]>
  quality: ReadonlyMap<string, number>
  usageObservedValue: boolean | undefined
  /** Protection marker per skill (list().protectedBy — single source). */
  protected: ReadonlyMap<string, string>
  /** Skills whose frontmatter the strict-YAML platform catalog cannot load. */
  catalogInvalid: ReadonlyMap<string, boolean>
}

export async function buildEnrichment(ctx: Context, library: SkillLibrary): Promise<Enrichment> {
  // Enrichment hooks (011 §7, v11 P1-1 + 0.3.11 meta): all use existing APIs
  // (parseFrontmatter / listSupportFiles / usage report / list().protectedBy);
  // a missing service degrades to unknown (never a fabricated pass).
  const skillUsage = ctx.get('skillUsage') as { report?(): Promise<UsageMap> } | undefined
  const usageMap = skillUsage?.report ? await skillUsage.report() : undefined
  const usageObservedValue = usageMap ? usageObserved(usageMap) : undefined
  const descriptions = new Map<string, string>()
  const supportFiles = new Map<string, readonly string[]>()
  const quality = new Map<string, number>()
  const protectedMap = new Map<string, string>()
  const catalogInvalid = new Map<string, boolean>()
  for (const entry of await library.list()) {
    // A1-17 (v18): an unknown marker probe is treated as protected, not as
    // unprotected (see SkillSummary.protectionUnknown).
    if (entry.protectionUnknown) protectedMap.set(entry.name, 'unknown')
    else if (entry.protectedBy) protectedMap.set(entry.name, entry.protectedBy)
    // E-9 parity with drift-scan.ts: one unreadable ENTRY (transient EACCES/EIO)
    // degrades that entry alone; a throw here would fail the whole scan before
    // the sibling guard below ever runs.
    // `unknown`, not `string | null`: the reader contract is JSON-shaped in
    // practice, and F-01 records a backend that resolves undefined — the guard
    // below must stay reachable, so the value is narrowed rather than trusted.
    let body: unknown
    try {
      body = await library.read(entry.name)
    } catch (error) {
      // Swallowed on purpose: the entry's enrichment stays unknown (never a
      // fabricated value) and the fact that it was skipped stays visible.
      ctx.logger.warn(`evolution-maintenance: enrichment skipped unreadable skill "${entry.name}": ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    // F-01: the empty-read guard matches drift-scan.ts (null AND
    // undefined) — an injected reader that resolves undefined (instead of the
    // concrete SkillLibrary's null) must skip the entry, not TypeError inside
    // parseFrontmatter below. The `as` widens the typed read exactly because
    // the reader contract is JSON-shaped in practice.
    if (typeof body !== 'string') continue
    const parsed = parseFrontmatter(body)
    // V27 G2.1: one read carries both the values and the catalog verdict. The
    // platform catalog parses strict YAML, so an unquoted `: ` or a block the
    // strict parser rejects makes the skill invisible to it while the family
    // still routes from the lenient fallback — reported here, never silent.
    if (frontmatterCatalogInvalid(body)) catalogInvalid.set(entry.name, true)
    const description = parsed?.frontmatter.description
    if (typeof description === 'string' && description.trim().length > 0) {
      descriptions.set(entry.name, description)
    }
    // N14: only the PRESENT branch may claim "these are the support files" —
    // an unreadable directory stays out of the map instead of reading as none.
    const files = await library.listSupportFiles(entry.name)
    if (isPresent(files) && files.value.length > 0) supportFiles.set(entry.name, files.value)
    const record = usageMap?.get(entry.name)
    if (typeof record?.quality_score === 'number') quality.set(entry.name, record.quality_score)
  }
  return { descriptions, supportFiles, quality, usageObservedValue, protected: protectedMap, catalogInvalid }
}
