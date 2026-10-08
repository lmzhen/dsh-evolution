/**
 * The adapter between the platform's client settings seat and this bundle's cards.
 *
 * One place maps `configForms.get(entryId)` to the three things a card needs — a
 * snapshot, a subscription and the two write calls — so our own section's cards and the
 * Plugins page's per-row entry cannot drift apart in how they read or write a row.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */
import type { ConfigFormLike, ConfigFormSnapshotLike, ConfigFormsSeat, ParamSectionSnapshot, ParamSectionSource } from './seam.ts'

/** What a card shows when this UI found no settings seat at all. */
export const SEAT_MISSING: ParamSectionSnapshot = Object.freeze({
  status: 'unavailable',
  value: undefined,
  user: undefined,
  writable: false,
  reason: 'seat-missing',
})

/**
 * Whether a value is a plain section object.
 * @param value - the value to test.
 * @returns true for a non-null, non-array object.
 */
export function isSection(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
    ...snapshot.status === 'unavailable' ? { reason: 'not-served' as const } : {},
  }
}

/**
 * The live source one row's card binds.
 * @param seat - the probed settings seat, when the deployment composed it.
 * @param namespace - the row's entry id.
 * @returns the source; without a seat it reports the stated empty state and never notifies.
 */
export function sourceFor(seat: ConfigFormsSeat | undefined, namespace: string): ParamSectionSource {
  if (seat === undefined) return { getSnapshot: () => SEAT_MISSING, subscribe: () => () => {} }
  const form = seat.get<Record<string, unknown>>(namespace)
  return { getSnapshot: () => sectionSnapshotOf(form.getSnapshot()), subscribe: listener => form.subscribe(listener) }
}

/**
 * The write pair for one row.
 * @param seat - the probed settings seat, when the deployment composed it.
 * @param namespace - the row's entry id.
 * @returns the two calls a card's save/reset path uses; without a seat they resolve without writing.
 */
export function writeFaceFor(seat: ConfigFormsSeat | undefined, namespace: string): {
  write: (field: string, value: unknown) => Promise<void>
  clear: (field: string) => Promise<void>
} {
  const form = (): ConfigFormLike | undefined => seat?.get<Record<string, unknown>>(namespace)
  return {
    write: async (field, value) => { await form()?.set(field, value) },
    clear: async (field) => { await form()?.unset(field) },
  }
}
