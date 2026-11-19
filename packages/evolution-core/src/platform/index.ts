/**
 * Compatibility re-export for the family's host platform boundary.
 *
 * Feature packages migrate to the adapter's narrow entries in P0b. This
 * subpath keeps the port and helper surface together while the concrete
 * Cordis service stays on the adapter's ./service entry.
 *
 * @module @deepseek-ai/dsh-evolution-core/platform
 */
export * from '@deepseek-ai/dsh-evolution-adapter/ports'
export * from '@deepseek-ai/dsh-evolution-adapter/values'
