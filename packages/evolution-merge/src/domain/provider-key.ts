/** Provider lexical normalization shared by plan/report. */
const PROVIDER = /^[a-z0-9][a-z0-9._-]*$/
export function normalizeProviderKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('provider must be a string')
  const normalized = value.trim().toLowerCase()
  if (normalized === '' || normalized.includes('/') || normalized.includes(':') || !PROVIDER.test(normalized)) throw new Error('provider key is invalid: ' + String(value))
  return normalized
}
