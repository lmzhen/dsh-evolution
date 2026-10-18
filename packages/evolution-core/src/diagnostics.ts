// DiagnosticsView contract: the ONE home of the doctor key set (W8 builds the view, W7 mirrors
// it type-only into clients, CLI and panels read the same keys).
export const DIAGNOSTICS_VIEW_SCHEMA_VERSION = 2 as const

export const DIAGNOSTICS_FACT_KEYS = [
  'platform-line',
  'family-version',
  'install-form',
  'preset-ids',
  'readonly-contract',
  'upgrade-order',
  'fallback-map',
] as const

export const DIAGNOSTICS_RUNTIME_KEYS = [
  'subagent-channel',
  'restricted-preset',
  'host-surface',
  'session-fold',
  'platform-services',
  'runs',
  'platform-pairing',
  'install-form-detected',
] as const

export type DiagnosticsFactKey = (typeof DIAGNOSTICS_FACT_KEYS)[number]
export type DiagnosticsRuntimeKey = (typeof DIAGNOSTICS_RUNTIME_KEYS)[number]
export type DiagnosticStatus = 'ok' | 'warn' | 'fail' | 'unknown'

export interface DocFactRow {
  readonly key: DiagnosticsFactKey
  readonly label: string
  readonly value: string
  readonly home: string
}

export interface DiagnosticRow {
  readonly key: DiagnosticsRuntimeKey
  readonly label: string
  readonly status: DiagnosticStatus
  readonly detail?: string
  readonly remedy?: string
}

export interface DiagnosticsView {
  readonly schemaVersion: typeof DIAGNOSTICS_VIEW_SCHEMA_VERSION
  readonly generatedAt: string
  readonly facts: readonly DocFactRow[]
  readonly runtime: readonly DiagnosticRow[]
}
