/** Locale-independent date/time formatting shared by the reading surfaces. */
export interface LocalDateTimeOptions {
  /** Include seconds (merge/audit rows) or only minutes (version lists). */
  readonly seconds?: boolean
}

/**
 * Format an ISO string, epoch milliseconds, or null as local wall time.
 * Invalid values return null; callers decide how to say "unknown".
 * @param value - ISO string, epoch ms, or null.
 * @param options - seconds on/off; defaults to on.
 * @returns the formatted local time, or null when the value is absent/invalid.
 */
export function formatLocalDateTime(value: string | number | null | undefined, options: LocalDateTimeOptions = {}): string | null {
  if (value === null || value === undefined) return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  const pad = (part: number): string => String(part).padStart(2, '0')
  const head = String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  return options.seconds === false ? head : head + ':' + pad(date.getSeconds())
}
