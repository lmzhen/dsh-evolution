// GENERATED FILE -- do not edit. Source: evolution-core/src/guards.ts
// Regenerate with: node packages/scripts/gen-client-guards.mjs <evolution-root>
// (G7.1/A8: the client bundles externalize @deepseek-ai/*, so the shared predicate is EMITTED here.)

/**
 * Is this a non-null, non-array object (what JSON calls an object)?
 * @param value - the value to test.
 * @returns whether it is a plain object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a value as a record, or undefined when it is not one.
 * @param value - the value to read.
 * @returns the value typed as a record, or undefined.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}
