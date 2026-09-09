/**
 * Threat scanning for agent-authored memory and skill content.
 *
 * Ported as a small, dependency-free subset of Hermes Agent's
 * `tools/threat_patterns.py` + hermes-claw `threats.ts`.
 *
 * Policy (P1-1, v19): a finding either BLOCKS the write or only REPORTS.
 * Blocking is reserved for shapes with no legitimate use in stored knowledge
 * (prompt-injection phrasing, credential exfiltration, the invisible-character
 * smuggling core). Typography and presentation characters that are legitimate
 * in ordinary prose — variation selectors (❤️), zero-width non-joiner, soft
 * hyphen from PDF paste, Arabic letter mark, Mongolian vowel separator — are
 * REPORT findings: they stay visible to operators and tests but never reject a
 * write. Blocking them turned every emoji into a security event.
 */

import { clampedNumber } from './numeric.ts'

export type ThreatScope = 'all' | 'context' | 'strict'

export interface ThreatFinding {
  label: string
  category: string
  scope: ThreatScope
  /** P1-1 (v19): `block` (default) refuses the write; `report` is an audit
   * trail entry only. Absent means `block`. */
  severity?: 'block' | 'report'
}

interface ThreatPattern extends ThreatFinding {
  regex: RegExp
}

const FILLER = String.raw`(?:\w+\s+){0,8}`

const PATTERNS: ThreatPattern[] = [
  // Prompt injection / rule override.
  { label: 'prompt_injection_ignore', category: 'prompt_injection', scope: 'all', regex: new RegExp(String.raw`ignore\s+${FILLER}(?:previous|above|prior|all)\s+${FILLER}instructions`, 'i') },
  // P2-2 (v18): the FILLER between the quantifier and the noun closes
  // "disregard all previous instructions" / "disregard any prior rules",
  // which the bare form missed while its sibling `prompt_injection_ignore`
  // already had it.
  { label: 'disregard_rules', category: 'prompt_injection', scope: 'all', regex: new RegExp(String.raw`disregard\s+${FILLER}(?:your|all|any)\s+${FILLER}(?:instructions|rules|guidelines)`, 'i') },
  { label: 'system_prompt_override', category: 'prompt_injection', scope: 'all', regex: /system\s+prompt\s+override/i },
  { label: 'bypass_restrictions', category: 'prompt_injection', scope: 'all', regex: /act\s+as\s+(?:if|though)\s+(?:you\s+)?(?:have\s+no|don'?t\s+have)\s+(?:restrictions?|limits?|rules)/i },
  { label: 'new_system_prompt', category: 'prompt_injection', scope: 'strict', regex: new RegExp(String.raw`new\s+${FILLER}system\s+${FILLER}prompt`, 'i') },
  { label: 'forget_everything', category: 'prompt_injection', scope: 'strict', regex: new RegExp(String.raw`forget\s+${FILLER}(?:everything|all)\s+${FILLER}(?:discussed|you\s+know)`, 'i') },

  // Role hijacking / jailbreak-adjacent instructions.
  { label: 'role_hijack', category: 'role_hijacking', scope: 'context', regex: /you\s+are\s+now\s+(?:a|an|the|acting|playing|pretending)/i },
  { label: 'fake_update', category: 'role_hijacking', scope: 'context', regex: new RegExp(String.raw`you\s+have\s+been\s+${FILLER}(?:updated|upgraded|patched)\s+to`, 'i') },
  { label: 'identity_override', category: 'role_hijacking', scope: 'context', regex: /\bname\s+yourself\s+\w+/i },
  { label: 'remove_filters', category: 'role_hijacking', scope: 'context', regex: /(?:respond|answer|reply)\s+without\s+(?:restrictions?|limitations?|filters?|safety)/i },

  // Deception and context exfiltration.
  { label: 'deception_hide', category: 'deception', scope: 'all', regex: new RegExp(String.raw`do\s+not\s+${FILLER}tell\s+${FILLER}the\s+user`, 'i') },
  { label: 'leak_system_prompt', category: 'deception', scope: 'context', regex: new RegExp(String.raw`output\s+${FILLER}(?:system|initial)\s+prompt`, 'i') },
  { label: 'context_exfil', category: 'exfiltration', scope: 'strict', regex: /(?:include|output|print|share)\s+(?:the\s+)?(?:conversation|chat\s+history|previous\s+messages|(?:full|entire)\s+context)/i },
  { label: 'send_to_url', category: 'exfiltration', scope: 'strict', regex: /(?:send|post|upload|transmit)\s+[^\n]{0,512}\s+(?:to|at)\s+https?:\/\//i },

  // Shell-based secret exfiltration. V8-13 (0.3.47): `\b` word boundaries —
  // the bare `cat`/`curl`/`wget` substrings matched inside `concat`/`scurl`
  // prose (`[^\n]{0,512}` can be empty), locking EVERY write; the C2 table
  // next to this one already uses `\b` — this row now matches that discipline.
  { label: 'exfil_curl', category: 'exfiltration', scope: 'all', regex: /\bcurl\s+[^\n]{0,512}\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i },
  { label: 'exfil_wget', category: 'exfiltration', scope: 'all', regex: /\bwget\s+[^\n]{0,512}\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i },
  { label: 'read_secrets', category: 'exfiltration', scope: 'all', regex: /\bcat\s+[^\n]{0,512}(?:\.env(?!\w)|(?:\bcredentials\b)|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i },

  // Persistence / backdoor / harness-config tampering. V9-10 (0.3.51):
  // `\b` word boundaries — the bare `authorized_keys` substring matched inside
  // OTHER underscore-joined words (`unauthorized_keys`-style compounds);
  // real references are `.ssh/authorized_keys` / `~/.ssh/authorized_keys`,
  // where the word sits on its own boundary.
  { label: 'ssh_backdoor', category: 'persistence', scope: 'strict', regex: /\bauthorized_keys\b/i },
  { label: 'agent_config_mod', category: 'persistence', scope: 'strict', regex: /(?:update|modify|edit|write|change|append|add\s+to)\s+(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)/i },
  { label: 'hermes_env', category: 'persistence', scope: 'strict', regex: /\$?HOME\/\.hermes|~\/\.hermes|\.hermes\/\.env|%USERPROFILE%[\\/]\.hermes/i },

  // C2 / promptware vocabulary.
  { label: 'c2_node_registration', category: 'c2_promptware', scope: 'context', regex: /register\s+(?:as\s+)?a?\s*node/i },
  { label: 'c2_heartbeat', category: 'c2_promptware', scope: 'context', regex: /(?:heartbeats?|beacon|check[\s-]?in)\s+(?:to|with)/i },
  { label: 'c2_task_pull', category: 'c2_promptware', scope: 'context', regex: /pull\s+(?:new\s+)?tasks?/i },
  { label: 'known_c2_framework', category: 'c2_promptware', scope: 'context', regex: /\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b/i },

  // Hardcoded secrets.
  { label: 'hardcoded_secret', category: 'hardcoded_secrets', scope: 'strict', regex: /(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][a-z0-9+/=_-]{20,}["']/i },
  // P3-22 (v14): a JWT is `base64url.base64url.base64url` — the dot-separated
  // alphabet is outside `hardcoded_secret`'s character class, so an embedded
  // token of that form went unreported. Dedicated pattern instead of widening
  // the generic class (which would raise false positives on dotted identifiers).
  { label: 'jwt_like_secret', category: 'hardcoded_secrets', scope: 'strict', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { label: 'private_key_block', category: 'hardcoded_secrets', scope: 'all', regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/ },
]

// P2-2 (v18) added an invisible/format set; P1-1 (v19) splits it by intent
// after the first cut rejected ordinary prose and emoji:
//   - BLOCKING: the smuggling core. Zero-width breaks/joiners with no prose
//     use (ZWSP, WORD JOINER, invisible operators, deprecated format
//     controls, BOM), COMBINING GRAPHEME JOINER, and the astral TAG block —
//     note the TAG range must live INSIDE the character class (P2-6: the v18
//     form wrote it after the class, where it matched the literal text).
//   - REPORT: typography/presentation characters that are smuggling vectors
//     only when abused: soft hyphen (PDF paste), Arabic letter mark, Mongolian
//     vowel separator, ZWNJ (Persian/Arabic typography), variation selectors
//     VS1-16 (emoji/text presentation, e.g. ❤️).
//   - ZWJ (U+200D) blocks only OUTSIDE an emoji sequence: 👨‍👩‍👧 is a joined
//     sequence and must pass; a ZWJ between ordinary words must not.
// Homoglyphs (e.g. Cyrillic look-alikes) remain outside this detector by design.
const INVISIBLE_CHAR_CLASS =
  '\\u034f\\u200b\\u2060\\u2061\\u2062\\u2063\\u2064\\u206a-\\u206f\\ufeff\\u{e0000}-\\u{e007f}'
const ZERO_WIDTH_CHARS = new RegExp(`[${INVISIBLE_CHAR_CLASS}]`, 'u')
const ZWJ_OUTSIDE_EMOJI = /(?<!\p{Extended_Pictographic})\u200d(?!\p{Extended_Pictographic})/u
const TYPOGRAPHY_CHARS = /[\u00ad\u061c\u180e\u200c\ufe00-\ufe0f]/
const BIDI_CHARS = /[\u202a-\u202e\u2066-\u2069]/

const SCOPE_ORDER: Record<ThreatScope, number> = { all: 1, context: 2, strict: 3 }

/**
 * Optional scan controls. Default behavior (`options` omitted) is unchanged:
 * every in-scope pattern blocks. Adapters that need to tolerate a specific
 * benign phrasing (e.g. a skill that legitimately opens with "You are now a ...")
 * can exclude that label by name here. This is opt-in and never widens strict
 * scope; it only permits callers to drop a known-innocent match.
 */
export interface ScanOptions {
  /** Pattern labels to skip during this scan. */
  excludeLabels?: readonly string[]
}

const NO_SCAN_OPTIONS: ScanOptions = {}

/** Minimum window size for the full-coverage scan (V6-05, 0.3.35). With the
 * proportional half-window step below, the overlap is `ceil(w/2)` — only a
 * window at or above this floor keeps the overlap above the longest pattern
 * span (~530 chars: `curl [^\n]{0,512} ...`), so a match straddling a window
 * boundary is fully inside at least one window (E-12, 0.3.16). The clamp
 * falls back to the default for a smaller caller value instead of risking a
 * blind zone. */
export const PATTERN_OVERLAP = 4096

/**
 * Scan text at `scope`. Patterns are cumulative: `strict` includes all scopes.
 * `options.excludeLabels` removes matching patterns without changing `scope`.
 * `maxScanChars` is the WINDOW SIZE, not a total cap (E-12, 0.3.16): the whole
 * text is always scanned in overlapping windows, so content beyond 65,536
 * characters (skill files may run to 100,000) is no longer a blind zone.
 */
export function scanThreats(text: string, scope: ThreatScope = 'strict', maxScanChars = 65_536, options: ScanOptions = NO_SCAN_OPTIONS): ThreatFinding[] {
  // V4-43 self-defense: a non-finite (NaN/±Infinity) or out-of-domain window
  // size would fold the window loop into an empty first window (or a NaN spin)
  // and make every in-scope pattern blind. Clamp to the default so an invalid
  // caller value still scans; the config layer is the first-line guard, this is
  // depth. V5-27: in-repo callers pass valid/clamped values (the threat
  // package pre-clamps its config-derived value), so behavior is unchanged —
  // but the clamp is the guarantee for any third-party caller, not a promise
  // about call sites. V6-05: the floor is now PATTERN_OVERLAP + 1 — a window
  // below it cannot guarantee full coverage (see PATTERN_OVERLAP).
  const windowSize = clampedNumber(maxScanChars, 65_536, { min: PATTERN_OVERLAP + 1 })
  const findings: ThreatFinding[] = []
  const excluded = new Set(options.excludeLabels ?? [])
  // P3-22 (v14): unicode obfuscation is scope-INDEPENDENT by design — the
  // smuggling core is never legitimate in stored knowledge, so it blocks even
  // under `scope: 'all'`. The exemption surface still applies: a deployment
  // that knows a label is benign can allowlist it like any other.
  // P1-1 (v19): the typography set reports without blocking (see the class
  // comment above); ZWJ is judged by context.
  if ((ZERO_WIDTH_CHARS.test(text) || ZWJ_OUTSIDE_EMOJI.test(text)) && !excluded.has('unicode_zero_width')) {
    findings.push({ label: 'unicode_zero_width', category: 'unicode_obfuscation', scope: 'all' })
  }
  if (TYPOGRAPHY_CHARS.test(text) && !excluded.has('unicode_typography')) {
    findings.push({ label: 'unicode_typography', category: 'unicode_obfuscation', scope: 'all', severity: 'report' })
  }
  if (BIDI_CHARS.test(text) && !excluded.has('unicode_bidi_override')) {
    findings.push({ label: 'unicode_bidi_override', category: 'unicode_obfuscation', scope: 'all' })
  }
  const normalized = text.normalize('NFKC')
  const windows: string[] = []
  if (normalized.length <= windowSize) {
    windows.push(normalized)
  } else {
    // V6-05 (0.3.35): proportional half-window step. Overlap = `ceil(w/2)`, so
    // every position is covered by ~2 windows and the scan cost is O(n × 2)
    // instead of the O(n × w) cliff the old fixed-overlap step produced for
    // small windows (w ≤ PATTERN_OVERLAP collapsed the step to 1). A wider
    // overlap never drops a match — findings are per label/scope, not per
    // location.
    const step = Math.max(Math.floor(windowSize / 2), 1)
    for (let start = 0; start < normalized.length; start += step) {
      windows.push(normalized.slice(start, start + windowSize))
    }
  }
  const seen = new Set<string>()
  for (const window of windows) {
    for (const pattern of PATTERNS) {
      if (SCOPE_ORDER[pattern.scope] > SCOPE_ORDER[scope]) continue
      if (excluded.has(pattern.label)) continue
      if (!pattern.regex.test(window)) continue
      const key = `${pattern.label}|${pattern.scope}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({
        label: pattern.label,
        category: pattern.category,
        scope: pattern.scope,
      })
    }
  }
  return findings
}

/** Blocking policy (P1-1, v19): a finding blocks unless it is explicitly
 * `report`-only. Pattern findings carry no severity and therefore block as
 * before. */
export function evaluateThreat(text: string, scope: ThreatScope = 'strict', maxScanChars = 65_536, options: ScanOptions = NO_SCAN_OPTIONS): { blocked: boolean; findings: ThreatFinding[] } {
  const findings = scanThreats(text, scope, maxScanChars, options)
  return { blocked: findings.some(finding => finding.severity !== 'report'), findings }
}

/** User-facing block message for memory writes. */
export function scanMemoryThreats(text: string, maxScanChars = 65_536, options: ScanOptions = NO_SCAN_OPTIONS): string | null {
  const { blocked, findings } = evaluateThreat(text, 'strict', maxScanChars, options)
  if (!blocked) return null
  const pattern = findings.find(f => f.category !== 'unicode_obfuscation')
  // WD2 (0.3.56): every user-facing block carries the exemption surface — a
  // legitimate DevOps/skill phrase must end in a next step, not a dead end.
  const exemptionHint = ' A deployment that needs a specific label can exempt it via threatExemptLabels (see the README env/dial reference).'
  if (pattern) return `Blocked by security scan (${pattern.label}). Rephrase without instruction-like language.${exemptionHint}`
  return `Blocked by security scan: invisible or potentially malicious Unicode detected.${exemptionHint}`
}

/** User-facing block message for skill content writes. */
export function scanContentThreats(text: string, maxScanChars = 65_536, options: ScanOptions = NO_SCAN_OPTIONS): string | null {
  const { blocked, findings } = evaluateThreat(text, 'strict', maxScanChars, options)
  if (!blocked) return null
  return `Blocked by security scan (${findings[0]?.label ?? 'unknown'}). This content appears to contain potentially malicious instructions. Installations with a known-innocent label can exempt it via threatExemptLabels (README dial reference).`
}

/**
 * V10-03 (P2-18): suffix the SkillLibrary/MemoryStore write gates append to a
 * block message — the hit label is already embedded by scanContentThreats /
 * scanMemoryThreats, this names the deployable self-heal path so the model
 * (or operator) can allowlist a known-benign label. P2-4 (v14): the
 * evolution-threat guard channel now carries `threatExemptLabels` too, so its
 * block message (which embeds the same exemption sentence) is accurate there
 * as well; this suffix stays store-side because the guard returns the scan
 * message verbatim.
 */
export const THREAT_EXEMPT_HINT = ' If this is a legitimate false positive, the deployment can allow its label via the threatExemptLabels store option.'
