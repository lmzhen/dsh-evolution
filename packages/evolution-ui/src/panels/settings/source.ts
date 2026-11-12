/**
 * The two projections the settings cards read from a platform client form snapshot.
 *
 * W9-g3-c (audit 06-P2 F5): this module used to carry a whole adapter layer — `sourceFor`,
 * `writeFaceFor`, `stableProjection`, `createSourceCache`, the seat-missing constants — with no
 * production consumer: the settings page binds its own `form` face and hands the card a snapshot,
 * and only tests ever called the adapter. Dead code that documents a data path nobody takes is
 * worse than no code, so it is gone; what production actually uses stays here.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import type { ConfigFormSnapshotLike, ParamSectionSnapshot } from './seam.ts'

// G7.1/A8: the predicate is generated from core (guards.ts). Import for this module's own calls AND
// re-export, so the card and the predicate cannot drift.
import { isRecord as isSection } from './guards.ts'
export { isSection }

/**
 * Project one platform snapshot into the card's own shape.
 * @param snapshot - the seat's snapshot.
 * @returns the card's snapshot, with the reason an unavailable one is unavailable.
 */
export function sectionSnapshotOf(snapshot: ConfigFormSnapshotLike): ParamSectionSnapshot {
  return {
    status: snapshot.status,
    value: isSection(snapshot.value) ? snapshot.value : undefined,
    user: snapshot.user,
    writable: snapshot.writable,
    // U-5: the composition layer a cleared field reverts to (the platform's `base`).
    base: isSection(snapshot.base) ? snapshot.base : undefined,
    // G5/W7 S5: the platform's `mode` is no longer modelled — every family row writes the host
    // configuration (the card states that once, as a fixed line). An unavailable row is not-served.
    ...snapshot.status === 'unavailable' ? { reason: ((snapshot as { reason?: string }).reason ?? 'not-served') as 'not-served' } : {},
    ...(snapshot as { stale?: boolean }).stale === true ? { stale: true } : {},
  }
}
