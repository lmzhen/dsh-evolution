/**
 * Mechanical-facts rendering for the maintenance subagent (011 §6).
 *
 * One canonical block: opening tag with version + joint signature, one
 * `[FACT]`/`[UNKNOWN]` line per signal, closing tag. The template side
 * renders its own `<MAINTAIN_PROMPT>` header with the same signature, so
 * the model can compare the two heads (011 mismatch protocol). All rendered
 * value/detail text passes through the optional redactor before it leaves
 * the session.
 */

import {
  redactSecrets,
  type DriftReport,
  type DriftSignal,
} from '@deepseek-ai/dsh-evolution-core'

export interface RenderFactsOptions {
  /** signals_version — changes whenever the signal set/thresholds change. */
  signalsVersion: string
  /** Joint signature: sha256(template-text + signal-definitions) — shared with MAINTAIN_PROMPT head. */
  signature: string
  /** Optional redactor; defaults to core `redactSecrets`. */
  redact?: ((text: string) => string) | undefined
}

export function renderFacts(report: DriftReport, options: RenderFactsOptions): string {
  const redact = options.redact ?? redactSecrets
  const lines: string[] = []
  lines.push(`<<<MECHANICAL_FACTS v=${options.signalsVersion} sig=${options.signature}>>>`)
  for (const signal of report.library) {
    lines.push(...renderSignal(signal, redact))
  }
  for (const skill of report.skills) {
    // 0.3.11: always-present meta — protection marker and catalog loadability
    // (never a conditional line: the auditor must see "none"/"visible" too).
    // The header is the single place §7's protected rule can be exercised.
    const meta = [`protected=${skill.protected ?? 'none'}`, `catalog=${skill.catalogInvalid === true ? 'yaml-invalid' : 'visible'}`]
    lines.push(`# skill=${skill.name} (${meta.join(' ')})`)
    for (const signal of skill.signals) {
      lines.push(...renderSignal(signal, redact))
    }
  }
  lines.push('<<<END FACTS>>>')
  return lines.join('\n')
}

function renderSignal(signal: DriftSignal, redact: (text: string) => string): string[] {
  const prefix = signal.verdict === 'unknown' ? '[UNKNOWN]' : '[FACT]'
  // A2-13 (v18): a value carrying the closing delimiter (or a raw newline)
  // could end the facts block early and inject instructions. Escape both.
  const sanitize = (text: string): string => redact(text)
    .replaceAll('<<<END FACTS>>>', '<<<END FACTS (escaped)>>>')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
  const value = sanitize(signal.value)
  const parts = [`${prefix} signal=${signal.id}`, `value=${value}`, `verdict=${signal.verdict}`]
  if (signal.threshold !== undefined) parts.push(`threshold=${signal.threshold}`)
  if (signal.detail !== undefined) parts.push(`detail=${sanitize(signal.detail)}`)
  return [parts.join(' ')]
}
