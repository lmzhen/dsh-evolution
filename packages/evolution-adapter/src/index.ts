/**
 * Full adapter entry.
 *
 * - `./ports` is the composition-safe port surface.
 * - `./values` carries host-provided runtime helper values.
 * - `./service` is the Cordis `evolutionPlatform` service.
 *
 * Feature packages should use the narrow entries (`./ports`, `./values`) and
 * not this umbrella unless they need the service.
 */
export * from './ports.ts'
export * from './values.ts'
export * from './service.ts'
