/**
 * Shared library for the dsh-evolution plugin family.
 *
 * Pure stores, prompts, signals, lifecycle logic, threat scanning, IO seam
 * types, and session-event augmentations. This package owns no Cordis plugin
 * entry of its own; consumers import named exports from the package root so
 * published npm bundles never depend on source subpaths.
 * @module @deepseek-ai/dsh-evolution-core
 */

export * from './curator.ts'
export * from './evolution-events.ts'
export * from './gates.ts'
export * from './events.ts'
export * from './io.ts'
export * from './learn-prompt.ts'
export * from './memory-store.ts'
export * from './mutations.ts'
export * from './prompts.ts'
export * from './quality.ts'
export * from './skill-health.ts'
export * from './signals.ts'
export * from './skill-store.ts'
export * from './state-store.ts'
export * from './threats.ts'
export * from './usage.ts'
export * from './constants.ts'
