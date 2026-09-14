/**
 * Shared library for the dsh-evolution plugin family.
 *
 * Pure stores, prompts, signals, lifecycle logic, threat scanning, IO seam
 * types, and session-event augmentations. This package ships no runtime
 * plugin and no `./invariant` companion (v37 S2.1); consumers import named
 * exports from the package root so published npm bundles never depend on
 * source subpaths.
 *
 * ## Layer map (OPT-28, 2026-09) — locate code by LAYER, not by directory
 *
 * This one physical package carries THREE architecture layers of the family;
 * when adding or looking for something, go by the export's layer:
 *
 * - **Cross-cutting basics** — `state-store.ts` (env roots — the single
 *   source of DSH-home semantics), `serial.ts`, `numeric.ts`, `constants.ts`,
 *   `mutations.ts`, `events.ts`, `gates.ts`.
 * - **Security primitives** — `threats.ts` (content threat scanner),
 *   `redact.ts` (credential masking at model boundaries). Consumers:
 *   evolution-policy/threat, both stores, review, maintenance.
 * - **Core domain stores/logic** — `skill-store.ts` (skill tree engine +
 *   IO-seam consumer), `memory-store.ts`, `usage.ts`, `curator.ts`,
 *   `quality.ts`, `signals.ts`, `drift-signals.ts`, `skill-health.ts`,
 *   `preset-composition.ts`, `prompts.ts`, `learn-prompt.ts`,
 *   `evolution-events.ts`, `io.ts` (the ctx.evolutionIo seam itself).
 * @module @deepseek-ai/dsh-evolution-core
 */

export * from './curator.ts'
export * from './evolution-events.ts'
export * from './gates.ts'
export * from './events.ts'
export * from './env.ts'
export * from './io.ts'
export * from './learn-prompt.ts'
export * from './memory-store.ts'
export * from './mutations.ts'
export * from './preset-composition.ts'
export * from './prompts.ts'
export * from './quality.ts'
export * from './redact.ts'
export * from './review-channel.ts'
export * from './serial.ts'
export * from './probe.ts'
export * from './instance-scope.ts'
export * from './write-inventory.ts'
export * from './scope.ts'
export * from './skill-health.ts'
export * from './signals.ts'
export * from './drift-signals.ts'
export * from './skill-store.ts'
export * from './state-store.ts'
export * from './threats.ts'
export * from './tool-dispatch.ts'
export * from './usage.ts'
export * from './constants.ts'
export * from './numeric.ts'
export * from './opt-in.ts'
