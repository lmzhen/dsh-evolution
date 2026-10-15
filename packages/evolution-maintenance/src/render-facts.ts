/**
 * Mechanical-facts rendering for the maintenance subagent (011 §6).
 *
 * One canonical block: opening tag with version + joint signature, one
 * `[FACT]`/`[UNKNOWN]` line per signal, closing tag. The template side
 * renders its own `<MAINTAIN_PROMPT>` header with the same signature, so
 * the model can compare the two heads (011 mismatch protocol). Every rendered
 * field (value/detail/threshold/skill name) passes through the optional
 * redactor and the delimiter/newline escaping before it leaves the session.
 */

import {
  redactSecrets,
  type DriftReport,
  type DriftSignal,
} from '@deepseek-ai/dsh-evolution-core'

/** G3/3.3: what one footprint line reports about one registered store. */
export interface StoreFootprint {
  readonly id: string
  readonly unit: string
  /** The reading, when one exists; undefined renders as UNKNOWN instead of an invented zero. */
  readonly used?: number | undefined
  readonly bound: string
  readonly lastSweep?: string | undefined
  readonly removed?: number | undefined
  /** Set for a `manual` store that did not run: stated, never implied. */
  readonly skipped?: string | undefined
}

export interface RenderFactsOptions {
  /** signals_version — changes whenever the signal set/thresholds change. */
  signalsVersion: string
  /** Joint signature: sha256(template-text + signal-definitions) — shared with MAINTAIN_PROMPT head. */
  signature: string
  /** G3/3.3: one reading per registered bounded store (STORE_LEDGER). Absent ⇒ no footprint lines at
   * all, so an older caller keeps the exact block it had; a store with no reading renders as UNKNOWN
   * and a manual-trigger store that did not run says so — "not done" must never read as "nothing to do". */
  footprint?: readonly StoreFootprint[] | undefined
  /** Optional redactor; defaults to core `redactSecrets`. */
  redact?: ((text: string) => string) | undefined
}

export function renderFacts(report: DriftReport, options: RenderFactsOptions): string {
  const redact = options.redact ?? redactSecrets
  const sanitize = sanitizerFor(redact)
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
    // P2-20: the header is model-facing text exactly like a value line — a name
    // carrying a newline + the closing tag could end the block and forge lines.
    lines.push(`# skill=${sanitize(skill.name)} (${meta.join(' ')})`)
    for (const signal of skill.signals) {
      lines.push(...renderSignal(signal, redact))
    }
  }
  // G3/3.3: the footprint段 — one line per REGISTERED store, in ledger order, using the block's own
  // [FACT]/[UNKNOWN] grammar. A missing reading is UNKNOWN (never 0), and a manual store that did not
  // run carries skipped= so the auditor can tell "not done" from "nothing to do".
  for (const store of options.footprint ?? []) {
    const prefix = store.used === undefined || store.skipped !== undefined ? '[UNKNOWN]' : '[FACT]'
    const parts = [
      `${prefix} signal=store/${sanitize(store.id)}`,
      `unit=${sanitize(store.unit)}`,
      `bound=${sanitize(store.bound)}`,
      `used=${store.used === undefined ? 'unknown' : String(store.used)}`,
      `lastSweep=${sanitize(store.lastSweep ?? 'never')}`,
      `removed=${store.removed === undefined ? 'unknown' : String(store.removed)}`,
    ]
    if (store.skipped !== undefined) parts.push(`skipped=${sanitize(store.skipped)}`)
    parts.push(`verdict=${store.used === undefined || store.skipped !== undefined ? 'unknown' : 'fact'}`)
    lines.push(parts.join(' '))
  }
  lines.push('<<<END FACTS>>>')
  return lines.join('\n')
}

function renderSignal(signal: DriftSignal, redact: (text: string) => string): string[] {
  const prefix = signal.verdict === 'unknown' ? '[UNKNOWN]' : '[FACT]'
  const sanitize = sanitizerFor(redact)
  const value = sanitize(signal.value)
  const parts = [`${prefix} signal=${signal.id}`, `value=${value}`, `verdict=${signal.verdict}`]
  if (signal.threshold !== undefined) parts.push(`threshold=${sanitize(signal.threshold)}`)
  if (signal.detail !== undefined) parts.push(`detail=${sanitize(signal.detail)}`)
  return [parts.join(' ')]
}

/** A2-13: a value carrying the closing delimiter (or a raw newline) could end
 * the facts block early and inject instructions, so EVERY piece of rendered
 * model-facing text — value, detail, threshold, skill name — passes here. */
function sanitizerFor(redact: (text: string) => string): (text: string) => string {
  return text => redact(text)
    .replaceAll('<<<END FACTS>>>', '<<<END FACTS (escaped)>>>')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
}
