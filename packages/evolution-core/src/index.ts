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
 *   `mutations.ts`, `events.ts`, `gates.ts`, `errors.ts` (the error-code table),
 *   `payload.ts` (which of `facts`/`content` is the payload — one rule for the whole family).
 * - **Security primitives** — `threats.ts` (content threat scanner),
 *   `redact.ts` (credential masking at model boundaries),
 *   `fold-untrusted.ts` (untrusted text must not become prompt structure). Consumers:
 *   evolution-policy/threat, both stores, review, maintenance.
 * - **Core domain stores/logic** — `skill-store.ts` (skill tree engine +
 *   IO-seam consumer), `memory-store.ts`, `usage.ts`, `curator.ts`,
 *   `quality.ts`, `signals.ts`, `skill-reads.ts` (the read-before-write rule, shared by the
 *   tool path and the review's plan path), `drift-signals.ts`, `skill-health.ts`,
 *   `composition/composer.ts`, `prompts.ts`, `learn-prompt.ts`,
 *   `evolution-events.ts`, `evidence.ts` (which session frames count as content, for the plan
 *   path's evidence-class report), `session-projection.ts` (the live per-session units the family's
 *   log-shaped readers read instead of re-reading the session log), `io.ts` (the ctx.evolutionIo
 *   seam itself).
 * @module @deepseek-ai/dsh-evolution-core
 */

export * from './citations.ts'
// G1/1.1: the ONE authority behind a write (its type and the authorityFrom builder).
export * from './tree-write.ts'
export * from './package-identity.ts'
export * from './write-authority.ts'
export * from './write-gates.ts'
export * from './reference-rewrite.ts'
export * from './cost.ts'
export * from './skill-lint.ts'
export * from './health-baseline.ts'
export * from './curator.ts'
export * from './evolution-events.ts'
export * from './fuzzy-match.ts'
export * from './gates.ts'
export * from './guards.ts'
export * from './http-routes.ts'
export * from './events.ts'
export * from './env.ts'
export * from './errors.ts'
export * from './io.ts'
export * from './learn-prompt.ts'
export * from './memory-store.ts'
export * from './mutations.ts'
export * from './prompts.ts'
export * from './quality.ts'
export * from './redact.ts'
export * from './review-channel.ts'
export * from './run-registry.ts'
export * from './reports.ts'
export * from './long-runs.ts'
export * from './serial.ts'
export * from './probe.ts'
export * from './platform-services.ts'
export * from './instance-scope.ts'
export * from './write-inventory.ts'
export * from './scope.ts'
export * from './skill-health.ts'
export * from './signals.ts'
export * from './skill-reads.ts'
export * from './skill-row-cells.ts'
export * from './document-body.ts'
export * from './evidence.ts'
export * from './session-projection.ts'
export * from './drift-signals.ts'
export * from './skill-history.ts'
export * from './unit-members.ts'
export * from './skill-store.ts'
export * from './store-ledger.ts'
export * from './reachability.ts'
export * from './state-store.ts'
export * from './threats.ts'
export * from './tool-dispatch.ts'
export * from './usage.ts'
export * from './constants.ts'
export * from './params.ts'
export * from './namespace-migration.ts'
export * from './live.ts'
export * from './numeric.ts'
export * from './opt-in.ts'
export * from './payload.ts'
export * from './fold-untrusted.ts'

// G0 contract surface: /subagent types + state probe, /composition preset constants.
export * from './subagent/index.ts'
export {
  EVOLUTION_PRESET_IDS,
  REVIEWER_PRESET_ID,
  MAINTAINER_PRESET_ID,
  RESTRICTED_TOOLS_ROW_ID,
  RESTRICTOR_MODULE,
  RESTRICTED_PRESET_DISPLAY,
} from './composition/index.ts'
export type {
  RestrictedPresetKind,
  RestrictedPresetDisplay,
  RestrictedPresetRequest,
  RestrictedPresetState,
} from './composition/index.ts'
export * from './diagnostics.ts'
export * from './platform-line.generated.ts'
