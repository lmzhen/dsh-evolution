/**
 * The adapter between the platform's client settings seat and this bundle's cards.
 *
 * One place maps `configForms.get(entryId)` to the three things a card needs — a
 * snapshot, a subscription and the two write calls — so our own section's cards and the
 * Plugins page's per-row entry cannot drift apart in how they read or write a row.
 *
 * Two invariants live here, both required by the renderer's hook seam:
 *
 * - **Stable references.** The renderer binds this source through
 *   `useSyncExternalStoreWithSelector`, which compares the projected snapshot by reference.
 *   A `getSnapshot()` that builds a new object on every call never compares equal, so the
 *   card re-renders until React aborts it (minified invariant #185) and the slot error
 *   boundary replaces the card with an empty placeholder. The projection therefore caches
 *   per raw snapshot reference.
 * - **Never throws.** A throw from `getSnapshot()` happens inside the renderer's render pass,
 *   where this bundle cannot catch it and a card-level `try`/`catch` around a hook call is
 *   not legal React. Projection failures return a frozen unavailable snapshot instead.
 *
 * The seat itself is probed LAZILY: `apply()` runs before the settings shell may be active
 * (the shell declares `settings.section` and provides `configForms`), so reading the seat at
 * apply time would capture `undefined` for the whole life of the fiber.
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

/** What a card shows when the seat served the row but projecting it failed. A frozen constant
 * so a failing row keeps ONE reference: a fresh object per call would reintroduce the
 * render loop this module exists to prevent. */
export const PROJECTION_FAILED: ParamSectionSnapshot = Object.freeze({
  status: 'unavailable',
  value: undefined,
  user: undefined,
  writable: false,
  reason: 'projection-failed',
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
 * Bind one row's form to a projection that is stable per raw snapshot and never throws.
 * @param form - the row's client form, as the settings seat hands it over.
 * @returns the projection the card's hook reads.
 */
export function stableProjection(form: ConfigFormLike): () => ParamSectionSnapshot {
  let lastRaw: ConfigFormSnapshotLike | undefined
  let lastOut: ParamSectionSnapshot | undefined
  let reported = false
  const failed = (error: unknown): ParamSectionSnapshot => {
    if (!reported) {
      reported = true
      console.error('[evolution-settings] projecting one row failed:', error)
    }
    return PROJECTION_FAILED
  }
  return (): ParamSectionSnapshot => {
    let raw: ConfigFormSnapshotLike
    try {
      raw = form.getSnapshot()
    } catch (error) {
      return failed(error)
    }
    if (lastOut !== undefined && raw === lastRaw) return lastOut
    try {
      const next = sectionSnapshotOf(raw)
      lastRaw = raw
      lastOut = next
      return next
    } catch (error) {
      return failed(error)
    }
  }
}

/**
 * The lazily probed client settings seat.
 *
 * Probed at read time rather than captured at apply time: this row may activate before the
 * settings shell, and a captured `undefined` would pin every card to the empty state.
 * @returns the seat, or undefined while no settings surface is composed.
 */
export type SeatProbe = () => ConfigFormsSeat | undefined

/**
 * The live source one row's card binds.
 * @param probe - the lazily probed settings seat.
 * @param namespace - the row's entry id.
 * @returns the source; without a seat it reports the stated empty state, and it re-probes on
 *   every read so a seat that appears later is picked up without a timer.
 */
export function sourceFor(probe: SeatProbe, namespace: string): ParamSectionSource {
  const listeners = new Set<() => void>()
  let form: ConfigFormLike | undefined
  let projected: (() => ParamSectionSnapshot) | undefined
  let offForm: (() => void) | undefined
  const bind = (): void => {
    if (form !== undefined) return
    const seat = probe()
    if (seat === undefined) return
    form = seat.get<Record<string, unknown>>(namespace)
    projected = stableProjection(form)
  }
  const attach = (): void => {
    if (form === undefined || offForm !== undefined) return
    offForm = form.subscribe(() => { for (const listener of listeners) listener() })
  }
  return {
    getSnapshot: (): ParamSectionSnapshot => {
      bind()
      return projected === undefined ? SEAT_MISSING : projected()
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      bind()
      attach()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          offForm?.()
          offForm = undefined
        }
      }
    },
  }
}

/**
 * The write pair for one row.
 * @param probe - the lazily probed settings seat.
 * @param namespace - the row's entry id.
 * @returns the two calls a card's save/reset path uses; without a seat they resolve without writing.
 */
export function writeFaceFor(probe: SeatProbe, namespace: string): {
  write: (field: string, value: unknown) => Promise<void>
  clear: (field: string) => Promise<void>
} {
  const form = (): ConfigFormLike | undefined => probe()?.get<Record<string, unknown>>(namespace)
  return {
    write: async (field, value) => { await form()?.set(field, value) },
    clear: async (field) => { await form()?.unset(field) },
  }
}

/**
 * One source object per namespace, for the life of the plugin fiber.
 *
 * The renderer caches a hook binding per SOURCE OBJECT, so building a source per render
 * would re-bind the hook and remount the card. The cache is owned by the caller's fiber and
 * cleared on dispose.
 * @param probe - the lazily probed settings seat.
 * @returns the per-namespace source cache and its disposer.
 */
export function createSourceCache(probe: SeatProbe): {
  sourceFor: (namespace: string) => ParamSectionSource
  dispose: () => void
} {
  const sources = new Map<string, ParamSectionSource>()
  return {
    sourceFor: (namespace: string): ParamSectionSource => {
      const existing = sources.get(namespace)
      if (existing !== undefined) return existing
      const source = sourceFor(probe, namespace)
      sources.set(namespace, source)
      return source
    },
    dispose: (): void => { sources.clear() },
  }
}
