/**
 * Maintenance-scan determinism surface (design 011, Phase 1).
 *
 * Snapshot assembly (library → drift snapshot) and mechanical-facts
 * rendering. Pure functions: no IO inside signal computation; the assembled
 * snapshot is handed to `computeDriftSignals` (evolution-core) untouched.
 * The full service chain (commands → scan → render → subagent → validate)
 * is Phase 2; this module is the deterministic half, unit-testable without
 * a live library.
 * @module @deepseek-ai/dsh-evolution-maintenance
 */

export * from './drift-scan.ts'
export * from './render-facts.ts'
export * from './validate-plan.ts'
export * from './orchestrate.ts'
export * from './probe.ts'
