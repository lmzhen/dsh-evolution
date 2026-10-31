import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import {
  catalogRevisionOf,
  skillIndexRowOf,
  viewCatalogDigestOf,
  skillKeyOf,
  viewKeyOf,
  type SkillIndexRow,
  type SkillKey,
} from './identity.ts'

/** Query for one catalog view. */
export interface SkillIndexQuery {
  readonly cwd: string
  readonly scopeKey?: string | undefined
  readonly scope?: object | undefined
  readonly signal?: AbortSignal | undefined
}

/** Raw observation supplied by the platform `ctx.skills` adapter. */
export interface SkillIndexSourceSnapshot {
  readonly skills: readonly SkillSummary[]
  readonly complete: boolean
}

/** Read-only source the plugin adapter implements with `ctx.skills` + SkillLibrary. */
export interface SkillIndexSource {
  snapshot(query: SkillIndexQuery): Promise<SkillIndexSourceSnapshot>
  managedSkillKeys(): Promise<ReadonlySet<SkillKey>>
  protectedSkillKeys?(): Promise<ReadonlySet<SkillKey>>
  pinnedSkillKeys?(): Promise<ReadonlySet<SkillKey>>
}

/** One normalized per-view read model. */
export interface SkillIndexSnapshot {
  readonly viewKey: string
  readonly catalogRevision: string
  readonly viewCatalogDigest: string
  readonly rows: readonly SkillIndexRow[]
  readonly complete: boolean
}

function bySkillKey(left: SkillIndexRow, right: SkillIndexRow): number {
  return left.skillKey < right.skillKey ? -1 : left.skillKey > right.skillKey ? 1 : 0
}

/** Read-only view model; it does not cache or own a provider. */
export class SkillIndex {
  private readonly source: SkillIndexSource
  constructor(source: SkillIndexSource) { this.source = source }

  /**
   * Read one view from the source.
   * @param query - cwd/scope and cancellation for this observation.
   * @returns normalized rows and completeness; incomplete data is not hidden.
   */
  async read(query: SkillIndexQuery): Promise<SkillIndexSnapshot> {
    const [snapshot, managed, protectedKeys, pinnedKeys] = await Promise.all([
      this.source.snapshot(query),
      this.source.managedSkillKeys(),
      this.source.protectedSkillKeys?.() ?? Promise.resolve(new Set<SkillKey>()),
      this.source.pinnedSkillKeys?.() ?? Promise.resolve(new Set<SkillKey>()),
    ])
    const rows = snapshot.skills
      .map(summary => skillIndexRowOf(summary, managed.has(skillKeyOf(summary)), protectedKeys.has(skillKeyOf(summary)), pinnedKeys.has(skillKeyOf(summary))))
      .sort(bySkillKey)
    return {
      viewKey: viewKeyOf(query),
      catalogRevision: catalogRevisionOf(rows, snapshot.complete),
      viewCatalogDigest: viewCatalogDigestOf(viewKeyOf(query), rows, snapshot.complete),
      rows,
      complete: snapshot.complete,
    }
  }
}

export * from './identity.ts'
export * from './domain-map.ts'

export * from './projection.ts'

export * from './adapter.ts'

export * from './features.ts'
export * from './stages.ts'
export * from './search.ts'

export * from './domain-map-store.ts'

export * from './domain-view.ts'

export * from './domain-policy.ts'
export * from './domain-generation.ts'

export * from './domain-description.ts'
export * from './domain-quality.ts'
export * from './domain-metrics.ts'

export * from './domain-projection.ts'
export * from './session-projection.ts'

export * from './tool.ts'

export * from './assignment.ts'

export * from './maintenance.ts'

export * from './ui.ts'

export * from './security.ts'

export * from './session-store.ts'

export * from './runtime.ts'

export * from './assignment-sidecar.ts'

export * from './search-judge.ts'

export * from './awareness.ts'

export * from './plugin.ts'

export * from './worker.ts'

export * from './domain-bootstrap.ts'

export * from './domain-generation-service.ts'

export * from './assignment-queue.ts'


export * from './domain-generation-prompt.ts'

export * from './shadow-evidence.ts'
