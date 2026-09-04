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
  frontmatterYamlUnsafeValues,
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
    if (entry.protectedBy) protectedMap.set(entry.name, entry.protectedBy)
    const body = await library.read(entry.name)
    if (body === null) continue
    const parsed = parseFrontmatter(body)
    // 0.3.11: surface catalog-unloadable frontmatter — the platform parses
    // strict YAML, so an unquoted `: ` (etc.) makes the skill invisible to
    // it while the lenient evolution parser still sees it. Raw-line scan
    // (quotes included): a value already normalized by the write path is
    // never re-flagged (single source with normalizeFrontmatter).
    if (frontmatterYamlUnsafeValues(body).length > 0) catalogInvalid.set(entry.name, true)
    const description = parsed?.frontmatter.description
    if (typeof description === 'string' && description.trim().length > 0) {
      descriptions.set(entry.name, description)
    }
    const files = await library.listSupportFiles(entry.name)
    if (files.length > 0) supportFiles.set(entry.name, files)
    const record = usageMap?.get(entry.name)
    if (typeof record?.quality_score === 'number') quality.set(entry.name, record.quality_score)
  }
  return { descriptions, supportFiles, quality, usageObservedValue, protected: protectedMap, catalogInvalid }
}
