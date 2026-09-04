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
}

export async function buildEnrichment(ctx: Context, library: SkillLibrary): Promise<Enrichment> {
  // Enrichment hooks (011 §7, v11 P1-1): all four use existing APIs; a
  // missing service degrades to unknown (never a fabricated pass).
  const skillUsage = ctx.get('skillUsage') as { report?(): Promise<UsageMap> } | undefined
  const usageMap = skillUsage?.report ? await skillUsage.report() : undefined
  const usageObservedValue = usageMap ? usageObserved(usageMap) : undefined
  const descriptions = new Map<string, string>()
  const supportFiles = new Map<string, readonly string[]>()
  const quality = new Map<string, number>()
  for (const entry of await library.list()) {
    const body = await library.read(entry.name)
    if (body === null) continue
    const parsed = parseFrontmatter(body)
    const description = parsed?.frontmatter.description
    if (typeof description === 'string' && description.trim().length > 0) {
      descriptions.set(entry.name, description)
    }
    const files = await library.listSupportFiles(entry.name)
    if (files.length > 0) supportFiles.set(entry.name, files)
    const record = usageMap?.get(entry.name)
    if (typeof record?.quality_score === 'number') quality.set(entry.name, record.quality_score)
  }
  return { descriptions, supportFiles, quality, usageObservedValue }
}
