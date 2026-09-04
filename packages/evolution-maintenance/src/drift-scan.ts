/**
 * Skill-library snapshot assembly for drift scanning.
 *
 * `computeDriftSignals` (evolution-core) is a pure function over a plain
 * snapshot; this module converts a SkillLibrary-like reader into that
 * snapshot. Quality score and usage-window status are caller-provided —
 * when absent they stay `undefined`, which the signal layer reports as
 * `unknown` (never a fabricated verdict).
 */

import type { DriftSkillSnapshot } from '@deepseek-ai/dsh-evolution-core'

/** Minimal SkillLibrary surface needed for snapshot assembly. */
export interface SkillLibraryLike {
  list(): Promise<ReadonlyArray<{ name: string }>>
  read(name: string): Promise<string | null | undefined>
}

export interface SnapshotOptions {
  /** Support-file relative paths per skill name, when the caller has them. */
  supportFiles?: ReadonlyMap<string, readonly string[]> | undefined
  /** Parsed frontmatter description per skill name, when available. */
  descriptions?: ReadonlyMap<string, string> | undefined
  /** Quality score per skill name, when the caller computed it. */
  quality?: ReadonlyMap<string, number> | undefined
  /** Protection marker per skill name (0.3.11). */
  protected?: ReadonlyMap<string, string> | undefined
  /** Skills whose frontmatter the strict-YAML catalog cannot load (0.3.11). */
  catalogInvalid?: ReadonlyMap<string, boolean> | undefined
  /** Usage observation window status (library-wide, applied to every snapshot
   * — the same value the facts block injects). The probe reads it straight off
   * the snapshot (E-36): without it the probe always answered 'unknown' while
   * the facts block reported the enrichment value. */
  usageObserved?: boolean | undefined
}

/**
 * Assemble drift snapshots from a library reader and optional enrichment.
 * Missing enrichment stays `undefined` → signal layer reports `unknown`.
 */
export async function snapshotFromLibrary(
  library: SkillLibraryLike,
  options: SnapshotOptions = {},
): Promise<DriftSkillSnapshot[]> {
  const entries = await library.list()
  const snapshots: DriftSkillSnapshot[] = []
  for (const entry of entries) {
    const body = await library.read(entry.name)
    if (body === undefined || body === null) continue
    snapshots.push({
      name: entry.name,
      body,
      description: options.descriptions?.get(entry.name),
      supportFiles: options.supportFiles?.get(entry.name),
      quality: options.quality?.get(entry.name),
      ...(options.protected?.get(entry.name) !== undefined ? { protected: options.protected.get(entry.name) } : {}),
      ...(options.catalogInvalid?.get(entry.name) === true ? { catalogInvalid: true } : {}),
      ...(options.usageObserved !== undefined ? { usageObserved: options.usageObserved } : {}),
    })
  }
  return snapshots
}
