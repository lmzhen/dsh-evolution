/** Locale-independent date/time formatting shared by the reading surfaces. */
export interface LocalDateTimeOptions {
  /** Include seconds (merge/audit rows) or only minutes (version lists). */
  readonly seconds?: boolean
}

/** Parse an ISO string, epoch ms, or null into a valid Date; null when absent/invalid. */
function toLocalDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date
}

const pad = (part: number): string => String(part).padStart(2, '0')

/** The local clock part, HH:MM[:SS]. */
function clockOf(date: Date, options: LocalDateTimeOptions): string {
  const head = pad(date.getHours()) + ':' + pad(date.getMinutes())
  return options.seconds === false ? head : head + ':' + pad(date.getSeconds())
}

/**
 * Format an ISO string, epoch milliseconds, or null as local wall time.
 * Invalid values return null; callers decide how to say "unknown".
 * @param value - ISO string, epoch ms, or null.
 * @param options - seconds on/off; defaults to on.
 * @returns the formatted local time, or null when the value is absent/invalid.
 */
export function formatLocalDateTime(value: string | number | null | undefined, options: LocalDateTimeOptions = {}): string | null {
  const date = toLocalDate(value)
  if (date === null) return null
  return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + clockOf(date, options)
}

/**
 * Format only the local clock part, HH:MM[:SS]; null when the value is absent/invalid.
 * @param value - ISO string, epoch ms, or null.
 * @param options - seconds on/off; defaults to on.
 * @returns the local clock text, or null.
 */
export function formatLocalClock(value: string | number | null | undefined, options: LocalDateTimeOptions = {}): string | null {
  const date = toLocalDate(value)
  return date === null ? null : clockOf(date, options)
}

/**
 * True when the value falls on the same local calendar day as now.
 * @param value - ISO string, epoch ms, or null.
 * @param now - the reference instant; defaults to the current time.
 * @returns whether both are the same local day; false for invalid input.
 */
export function isSameLocalDay(value: string | number | null | undefined, now: Date = new Date()): boolean {
  const date = toLocalDate(value)
  if (date === null) return false
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}
