import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'

/** Stable identity for one winning skill: provider + source + name, JSON-encoded. */
export type SkillKey = string

/** One view of the skill catalog: canonical cwd plus a stable scope key. */
export interface ViewIdentityInput {
  readonly cwd: string
  readonly scopeKey?: string | undefined
}

/** One normalized skill row in the read model. */
export interface SkillIndexRow {
  readonly skillKey: SkillKey
  readonly name: string
  readonly description: string
  readonly whenToUse?: string | undefined
  readonly provider: string
  readonly source: string
  readonly managed: boolean
  readonly modelInvocable: boolean
  readonly protected: boolean
  readonly pinned: boolean
  readonly threeFieldHash: string
}

/** Policy identity inputs; revisions are supplied by the owning policy store. */
export interface PolicyDigestInput {
  readonly globalPolicyRevision: string
  readonly workspaceOverlayRevision?: string | undefined
  readonly scopeOverlayRevision?: string | undefined
  readonly effectivePolicy: unknown
}

/** Projection identity inputs. */
export interface ProjectionDigestInput {
  readonly viewKey: string
  readonly mapVersion: string
  readonly policyDigest: string
  readonly viewCatalogDigest: string
  readonly adapterVersion: string
  readonly projectionSchemaVersion: string
  readonly discoveryMode: string
}

/** Search index identity inputs. */
export interface SearchIndexKeyInput {
  readonly viewKey: string
  readonly viewCatalogDigest: string
  readonly policyDigest: string
  readonly tokenizerVersion: string
  readonly indexSchemaVersion: string
  readonly discoveryMode: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: unknown): unknown {
  if (value instanceof Set) return { $set: [...value].map(canonical).sort((left, right) => JSON.stringify(left) < JSON.stringify(right) ? -1 : JSON.stringify(left) > JSON.stringify(right) ? 1 : 0) }
  if (value instanceof Map) return { $map: [...value.entries()].map(([key, entry]) => [canonical(key), canonical(entry)]).sort((left, right) => JSON.stringify(left) < JSON.stringify(right) ? -1 : JSON.stringify(left) > JSON.stringify(right) ? 1 : 0) }
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]))
  return value
}

function digest(value: unknown): string {
  return sha256(JSON.stringify(canonical(value)))
}

/** @returns stable key for the winning provider/source/name tuple. */
export function skillKeyOf(summary: Pick<SkillSummary, 'provider' | 'source' | 'name'>): SkillKey {
  return JSON.stringify([summary.provider, summary.source, summary.name])
}

/** @returns stable hash of the canonical cwd and optional scope key. */
export function viewKeyOf(input: ViewIdentityInput): string {
  return digest([resolve(input.cwd), input.scopeKey ?? null])
}

/** @returns hash of the three fields used by discovery/retrieval. */
export function threeFieldHashOf(input: Pick<SkillSummary, 'name' | 'description' | 'whenToUse'>): string {
  return digest([input.name, input.description, input.whenToUse ?? null])
}

/** @returns normalized row for one skill summary. */
export function skillIndexRowOf(summary: SkillSummary, managed: boolean, protectedSkill = false, pinned = false): SkillIndexRow {
  return {
    skillKey: skillKeyOf(summary),
    name: summary.name,
    description: summary.description,
    ...(summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse }),
    provider: summary.provider,
    source: summary.source,
    managed,
    modelInvocable: summary.invocation.modelInvocable,
    protected: protectedSkill,
    pinned,
    threeFieldHash: threeFieldHashOf(summary),
  }
}

/** @returns digest of the sorted rows plus completeness. */
export function catalogRevisionOf(rows: readonly SkillIndexRow[], complete: boolean): string {
  return digest([complete, rows.map(row => [
    row.skillKey,
    row.name,
    row.description,
    row.whenToUse ?? null,
    row.provider,
    row.source,
    row.managed,
    row.modelInvocable,
    row.protected,
    row.pinned,
    row.threeFieldHash,
  ])])
}

/** @returns digest of a concrete per-view snapshot. */
export function viewCatalogDigestOf(viewKey: string, rows: readonly SkillIndexRow[], complete: boolean): string {
  return digest([viewKey, catalogRevisionOf(rows, complete)])
}

/** @returns digest of effective policy plus its revisions. */
export function policyDigestOf(input: PolicyDigestInput): string {
  return digest([
    input.globalPolicyRevision,
    input.workspaceOverlayRevision ?? null,
    input.scopeOverlayRevision ?? null,
    input.effectivePolicy,
  ])
}

/** @returns view-cache identity for one projection. */
export function projectionDigestOf(input: ProjectionDigestInput): string {
  return digest([
    input.viewKey,
    input.mapVersion,
    input.policyDigest,
    input.viewCatalogDigest,
    input.adapterVersion,
    input.projectionSchemaVersion,
    input.discoveryMode,
  ])
}

/** @returns view-cache identity for one search index. */
export function searchIndexKeyOf(input: SearchIndexKeyInput): string {
  return digest([
    input.viewKey,
    input.viewCatalogDigest,
    input.policyDigest,
    input.tokenizerVersion,
    input.indexSchemaVersion,
    input.discoveryMode,
  ])
}
